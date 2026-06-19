import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, extname, join } from 'path';
import JSZip from 'jszip';
import prisma from '@/lib/prisma';
import {
  generatedAssetResolver,
  generatedAssetWhitelist,
  type VNGeneratedAssetRecord,
} from './asset-bridge';
import type { VNGraphSaveData, VNSerializedValue } from './types';
import { validateVNGraph } from './validator';

export interface AIVNBookManifest {
  package_id: string;
  namespace: string;
  title: string;
  author_id: string;
  type: 'story';
  version: string;
  entry_story: string;
  assets: Record<string, {
    type: 'story';
    category: 'chapter';
    path: string;
    hash: string;
  }>;
  used_assets: string[];
  metadata: Record<string, unknown>;
}

export interface AIVNAssetsManifest {
  package_id: string;
  namespace: 'assets';
  title: string;
  type: 'assets';
  version: string;
  assets: Record<string, {
    type: 'image';
    category: string;
    ext: string;
    hash: string;
    metadata: Record<string, unknown>;
  }>;
}

export interface AIVNImportReport {
  source: 'gushi';
  source_story_id: string;
  source_chapter_id: string;
  target_package_id: string;
  target_chapter_asset_id: string;
  copied_asset_count: number;
  skipped_asset_count: number;
  graph_rewrite_count: number;
  validation: {
    valid: boolean;
    error: string;
    errors: string[];
  };
}

export interface AIVNInstallablePackage {
  packageId: string;
  chapterAssetId: string;
  files: Record<string, unknown>;
  folderPath?: string;
  zipBuffer?: Buffer;
}

interface AIVNObjectCopy {
  sourcePath: string;
  packagePath: string;
  scopedAssetId: string;
}

export async function buildAIVNInstallablePackage(options: {
  storyId: string;
  chapterId: string;
  format: 'folder' | 'zip';
}): Promise<AIVNInstallablePackage> {
  const story = await prisma.story.findUnique({ where: { id: options.storyId } });
  if (!story) throw new Error('Story not found.');

  const chapter = await prisma.generatedVNChapter.findFirst({
    where: { id: options.chapterId, storyId: options.storyId },
  });
  if (!chapter || !chapter.graphJson) throw new Error('VN chapter has no graphJson.');

  const [assets, characters] = await Promise.all([
    prisma.generatedAsset.findMany({
      where: { storyId: options.storyId, chapterId: options.chapterId },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.character.findMany({
      where: { storyId: options.storyId },
      select: { name: true },
    }),
  ]);

  const assetRecords: VNGeneratedAssetRecord[] = assets.map(asset => ({
    assetId: asset.assetId,
    scopedAssetId: asset.scopedAssetId,
    category: asset.category,
    publicUrl: asset.publicUrl,
    localPath: asset.localPath,
  }));
  const graph = chapter.graphJson as unknown as VNGraphSaveData;
  const validation = validateVNGraph(graph, {
    requireEndingTerminal: true,
    knownSpeakers: characters.map(character => character.name).filter(Boolean),
    assetWhitelist: generatedAssetWhitelist(assetRecords),
    assetResolver: generatedAssetResolver(assetRecords),
  });
  if (!validation.valid) throw new Error(`Stored VNGraph is invalid: ${validation.error}`);

  const packageId = buildAIVNPackageId(story.id);
  const chapterAssetId = 'story.chapter_001';
  const chapterFile = 'chapter_001.json';
  const chapterPath = `Books/${packageId}/Chapters/${chapterFile}`;
  const chapterJson = stringifyJson(graph);
  const chapterHash = sha256Text(chapterJson);
  const usedAssets = collectVNGraphAssetReferences(graph);
  const { assetsManifest, objectCopies, skippedAssetCount } = await buildRootAssetsManifest({
    storyTitle: story.title,
    packageId,
    assets,
    usedAssets,
  });

  const missingRefs = usedAssets.filter(scopedAssetId => !assetsManifest.assets[stripAssetScope(scopedAssetId)]);
  if (missingRefs.length > 0) {
    throw new Error(`AIVN package is missing asset manifest entries: ${missingRefs.join(', ')}`);
  }

  const bookManifest = buildAIVNBookManifest({
    packageId,
    title: story.title,
    authorId: story.ownerId,
    chapterAssetId,
    chapterFile,
    chapterHash,
    usedAssets,
    sourceStoryId: story.id,
    sourceChapterId: chapter.id,
    sourceMigrationRunId: chapter.migrationRunId,
  });
  const metadata = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'gushi',
    story: {
      id: story.id,
      title: story.title,
      description: story.description,
      genre: story.genre,
      era: story.era,
    },
    chapter: {
      id: chapter.id,
      branchId: chapter.branchId,
      sourceSegmentId: chapter.sourceSegmentId,
      status: chapter.status,
      migrationRunId: chapter.migrationRunId,
      migrationKind: chapter.migrationKind,
      sourceHash: chapter.sourceHash,
      createdAt: chapter.createdAt,
    },
  };
  const importReport: AIVNImportReport = {
    source: 'gushi',
    source_story_id: story.id,
    source_chapter_id: chapter.id,
    target_package_id: packageId,
    target_chapter_asset_id: chapterAssetId,
    copied_asset_count: objectCopies.length,
    skipped_asset_count: skippedAssetCount,
    graph_rewrite_count: 0,
    validation,
  };
  const validationReport = {
    valid: validation.valid,
    error: validation.error,
    errors: validation.errors,
    usedAssets,
  };

  const files: Record<string, unknown> = {
    [chapterPath]: graph,
    [`Books/${packageId}/manifest.json`]: bookManifest,
    'assets_manifest.json': assetsManifest,
    'import-report.json': importReport,
    'validation-report.json': validationReport,
    'metadata.json': metadata,
  };

  if (options.format === 'zip') {
    return {
      packageId,
      chapterAssetId,
      files,
      zipBuffer: await buildAIVNZipBuffer(files, objectCopies),
    };
  }

  const folderPath = await writeAIVNFolderExport(packageId, options.chapterId, files, objectCopies);
  return { packageId, chapterAssetId, files, folderPath };
}

export function buildAIVNPackageId(storyId: string): string {
  return `gushi_${safeName(storyId)}`;
}

export function buildAIVNBookManifest(options: {
  packageId: string;
  title: string;
  authorId: string;
  chapterAssetId: string;
  chapterFile: string;
  chapterHash: string;
  usedAssets: string[];
  sourceStoryId: string;
  sourceChapterId: string;
  sourceMigrationRunId?: string | null;
}): AIVNBookManifest {
  return {
    package_id: options.packageId,
    namespace: options.packageId,
    title: options.title,
    author_id: `server:${options.authorId}`,
    type: 'story',
    version: '0.1.0',
    entry_story: options.chapterAssetId,
    assets: {
      [options.chapterAssetId]: {
        type: 'story',
        category: 'chapter',
        path: `Chapters/${options.chapterFile}`,
        hash: `sha256-${options.chapterHash}`,
      },
    },
    used_assets: options.usedAssets,
    metadata: {
      source: 'gushi',
      source_story_id: options.sourceStoryId,
      source_chapter_id: options.sourceChapterId,
      source_migration_run_id: options.sourceMigrationRunId ?? null,
    },
  };
}

export function collectVNGraphAssetReferences(graph: VNGraphSaveData): string[] {
  const refs = new Set<string>();
  for (const node of graph.Nodes ?? []) {
    for (const value of Object.values(node.Data ?? {})) collectValueAssetReferences(value, refs);
  }
  return [...refs].sort();
}

async function buildRootAssetsManifest(options: {
  storyTitle: string;
  packageId: string;
  assets: Array<{
    assetId: string;
    scopedAssetId: string;
    category: string;
    publicUrl: string;
    localPath: string | null;
    mimeType: string | null;
    prompt: string | null;
  }>;
  usedAssets: string[];
}): Promise<{ assetsManifest: AIVNAssetsManifest; objectCopies: AIVNObjectCopy[]; skippedAssetCount: number }> {
  const manifest: AIVNAssetsManifest = {
    package_id: `${options.packageId}_assets`,
    namespace: 'assets',
    title: `${options.storyTitle} Assets`,
    type: 'assets',
    version: '0.1.0',
    assets: {},
  };
  const objectCopies: AIVNObjectCopy[] = [];
  let skippedAssetCount = 0;
  const used = new Set(options.usedAssets);

  for (const asset of options.assets) {
    if (used.size > 0 && !used.has(asset.scopedAssetId)) continue;
    if (!asset.localPath || !existsSync(asset.localPath)) {
      skippedAssetCount += 1;
      continue;
    }

    const buffer = await readFile(asset.localPath);
    const hash = sha256Buffer(buffer);
    const ext = guessObjectExtension(asset.localPath, asset.publicUrl, asset.mimeType);
    const objectPath = `Objects/sha256_${hash}${ext}`;
    manifest.assets[stripAssetScope(asset.scopedAssetId)] = {
      type: 'image',
      category: normalizeAssetCategory(asset.category),
      ext,
      hash: `sha256-${hash}`,
      metadata: {
        source: 'gushi',
        source_asset_id: asset.assetId,
        source_scoped_asset_id: asset.scopedAssetId,
        source_public_url: asset.publicUrl,
        source_prompt: asset.prompt,
      },
    };
    objectCopies.push({
      sourcePath: asset.localPath,
      packagePath: objectPath,
      scopedAssetId: asset.scopedAssetId,
    });
  }

  return { assetsManifest: manifest, objectCopies, skippedAssetCount };
}

async function buildAIVNZipBuffer(files: Record<string, unknown>, objectCopies: AIVNObjectCopy[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const [filePath, value] of Object.entries(files)) {
    zip.file(filePath, stringifyJson(value));
  }
  for (const object of objectCopies) {
    zip.file(object.packagePath, await readFile(object.sourcePath));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function writeAIVNFolderExport(
  packageId: string,
  chapterId: string,
  files: Record<string, unknown>,
  objectCopies: AIVNObjectCopy[],
): Promise<string> {
  const root = join(process.cwd(), 'exports', 'aivn-migration', 'packages', `${safeName(packageId)}-${safeName(chapterId)}`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });

  for (const [filePath, value] of Object.entries(files)) {
    const target = join(root, filePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, stringifyJson(value), 'utf8');
  }
  for (const object of objectCopies) {
    const target = join(root, object.packagePath);
    await mkdir(dirname(target), { recursive: true });
    await copyFile(object.sourcePath, target);
  }
  return root;
}

function collectValueAssetReferences(value: VNSerializedValue, refs: Set<string>) {
  if (!value || typeof value !== 'object') return;
  if (value.Kind === 'String' && typeof value.StringValue === 'string' && value.StringValue.startsWith('assets:')) {
    refs.add(value.StringValue);
  }
  if (Array.isArray(value.Items)) {
    for (const item of value.Items) collectValueAssetReferences(item, refs);
  }
  if (value.ObjectValue) {
    for (const child of Object.values(value.ObjectValue)) collectValueAssetReferences(child, refs);
  }
}

function stripAssetScope(scopedAssetId: string): string {
  return scopedAssetId.replace(/^assets:/, '');
}

function normalizeAssetCategory(category: string): string {
  if (/background/i.test(category)) return 'background';
  if (/character/i.test(category)) return 'character';
  if (/cg/i.test(category)) return 'cg';
  return category.toLowerCase();
}

function guessObjectExtension(localPath: string, publicUrl: string, mimeType: string | null): string {
  const direct = extname(localPath) || extname(publicUrl.split('?')[0]);
  if (direct) return direct.toLowerCase();
  if (mimeType === 'image/jpeg') return '.jpg';
  if (mimeType === 'image/webp') return '.webp';
  return '.png';
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sha256Buffer(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'package';
}

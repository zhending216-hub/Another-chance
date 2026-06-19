import { existsSync } from 'fs';
import { copyFile, mkdir, readFile, rm, writeFile } from 'fs/promises';
import { basename, join } from 'path';
import JSZip from 'jszip';
import prisma from '@/lib/prisma';
import {
  generatedAssetResolver,
  generatedAssetWhitelist,
  type VNGeneratedAssetRecord,
} from './asset-bridge';
import type { VNGraphSaveData } from './types';
import { validateVNGraph } from './validator';

export interface VNExportAsset {
  assetId: string;
  scopedAssetId: string;
  category: string;
  publicUrl: string;
  localPath: string | null;
  packagePath: string | null;
  mimeType: string | null;
  sha256: string | null;
  prompt: string | null;
}

export interface VNExportFiles {
  'chapter.json': VNGraphSaveData;
  'asset-manifest.json': {
    version: 1;
    assets: VNExportAsset[];
  };
  'metadata.json': Record<string, unknown>;
  'validation-report.json': Record<string, unknown>;
}

export interface VNExportPackage {
  files: VNExportFiles;
  folderPath?: string;
  zipBuffer?: Buffer;
}

export async function buildVNExportPackage(options: {
  storyId: string;
  chapterId: string;
  format: 'folder' | 'zip';
}): Promise<VNExportPackage> {
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

  const manifestAssets = buildAssetManifest(assets);
  const files: VNExportFiles = {
    'chapter.json': graph,
    'asset-manifest.json': {
      version: 1,
      assets: manifestAssets,
    },
    'metadata.json': {
      version: 1,
      exportedAt: new Date().toISOString(),
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
        repairAttempts: chapter.repairAttempts,
        createdAt: chapter.createdAt,
      },
    },
    'validation-report.json': {
      valid: validation.valid,
      error: validation.error,
      errors: validation.errors,
      assetCount: manifestAssets.length,
    },
  };

  if (options.format === 'zip') {
    return { files, zipBuffer: await buildZipBuffer(files, manifestAssets) };
  }

  const folderPath = await writeFolderExport(options.chapterId, files, manifestAssets);
  return { files, folderPath };
}

export function buildAssetManifest(assets: Array<{
  assetId: string;
  scopedAssetId: string;
  category: string;
  publicUrl: string;
  localPath: string | null;
  mimeType: string | null;
  sha256: string | null;
  prompt: string | null;
}>): VNExportAsset[] {
  return assets.map(asset => ({
    assetId: asset.assetId,
    scopedAssetId: asset.scopedAssetId,
    category: asset.category,
    publicUrl: asset.publicUrl,
    localPath: asset.localPath,
    packagePath: asset.localPath ? `assets/${basename(asset.localPath)}` : null,
    mimeType: asset.mimeType,
    sha256: asset.sha256,
    prompt: asset.prompt,
  }));
}

async function buildZipBuffer(files: VNExportFiles, assets: VNExportAsset[]): Promise<Buffer> {
  const zip = new JSZip();
  addJsonFiles(zip, files);
  const assetFolder = zip.folder('assets');
  for (const asset of assets) {
    if (!asset.localPath || !asset.packagePath || !existsSync(asset.localPath)) continue;
    assetFolder?.file(basename(asset.packagePath), await readFile(asset.localPath));
  }
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

async function writeFolderExport(
  chapterId: string,
  files: VNExportFiles,
  assets: VNExportAsset[],
): Promise<string> {
  const root = join(process.cwd(), 'exports', 'aivn', safeName(chapterId));
  await rm(root, { recursive: true, force: true });
  await mkdir(join(root, 'assets'), { recursive: true });

  await Promise.all(Object.entries(files).map(([name, value]) =>
    writeFile(join(root, name), JSON.stringify(value, null, 2), 'utf8'),
  ));

  for (const asset of assets) {
    if (!asset.localPath || !asset.packagePath || !existsSync(asset.localPath)) continue;
    await copyFile(asset.localPath, join(root, asset.packagePath));
  }
  return root;
}

function addJsonFiles(zip: JSZip, files: VNExportFiles) {
  for (const [name, value] of Object.entries(files)) {
    zip.file(name, JSON.stringify(value, null, 2));
  }
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').slice(0, 80) || 'chapter';
}

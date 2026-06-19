import { existsSync } from 'fs';
import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';
import {
  generatedAssetResolver,
  generatedAssetWhitelist,
  type VNGeneratedAssetRecord,
} from './asset-bridge';
import { collectVNGraphAssetReferences } from './aivn-package';
import type { VNAssetResolver, VNGraphSaveData, VNNodeSaveData } from './types';
import { validateVNGraph } from './validator';
import { resolveMigrationReportPath } from './migration-report';

export interface AIVNFusionQualityReport {
  version: 1;
  generatedAt: string;
  gitCommit: string | null;
  corpus: {
    storyCount: number;
    chapterCount: number;
    assetCount: number;
    validGraphCount: number;
    invalidGraphCount: number;
    readyChapterCount: number;
  };
  thresholds: {
    eligibleStoriesClassified: boolean;
    persistedGraphsValidate: boolean;
    referencedAssetsResolve: boolean;
    objectFilesComplete: boolean;
    failuresClassified: boolean;
  };
  stories: AIVNFusionQualityStory[];
  failures: string[];
  warnings: string[];
}

export interface AIVNFusionQualityStory {
  storyId: string;
  title: string;
  chapterCount: number;
  assetCount: number;
  chapters: AIVNFusionQualityChapter[];
}

export interface AIVNFusionQualityChapter {
  chapterId: string;
  storyId: string;
  status: string;
  migrationRunId: string | null;
  graph: {
    valid: boolean;
    error: string;
    startExists: boolean;
    terminalEndReachable: boolean;
    nodeCount: number;
  };
  assets: {
    referenced: string[];
    manifestComplete: boolean;
    objectFilesComplete: boolean;
    missingManifestRefs: string[];
    missingObjectRefs: string[];
  };
  visuals: {
    backgroundCount: number;
    tachiActionCount: number;
    illustrationActionCount: number;
    clearActionCount: number;
    visualActionCoverage: number;
  };
  ready: boolean;
  warnings: string[];
}

interface StoryRecord {
  id: string;
  title: string;
}

interface ChapterRecord {
  id: string;
  storyId: string;
  graphJson: unknown;
  status: string;
  migrationRunId: string | null;
}

interface AssetRecord extends VNGeneratedAssetRecord {
  storyId: string;
  chapterId: string | null;
  mimeType?: string | null;
  sha256?: string | null;
  prompt?: string | null;
}

interface CharacterRecord {
  storyId: string;
  name: string | null;
}

export async function generateAIVNFusionQualityReport(options: {
  generatedAt?: string;
  gitCommit?: string | null;
} = {}): Promise<AIVNFusionQualityReport> {
  const [stories, chapters, assets, characters] = await Promise.all([
    prisma.story.findMany({ select: { id: true, title: true }, orderBy: { createdAt: 'asc' } }),
    prisma.generatedVNChapter.findMany({
      select: {
        id: true,
        storyId: true,
        graphJson: true,
        status: true,
        migrationRunId: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.generatedAsset.findMany({
      select: {
        id: true,
        storyId: true,
        chapterId: true,
        assetId: true,
        scopedAssetId: true,
        category: true,
        publicUrl: true,
        localPath: true,
        mimeType: true,
        sha256: true,
        prompt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.character.findMany({
      select: { storyId: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);

  return buildAIVNFusionQualityReport({
    stories,
    chapters: chapters as ChapterRecord[],
    assets: assets as AssetRecord[],
    characters: characters as CharacterRecord[],
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    gitCommit: options.gitCommit ?? null,
  });
}

export function buildAIVNFusionQualityReport(input: {
  stories: StoryRecord[];
  chapters: ChapterRecord[];
  assets: AssetRecord[];
  characters?: CharacterRecord[];
  generatedAt: string;
  gitCommit: string | null;
}): AIVNFusionQualityReport {
  const storyById = new Map(input.stories.map(story => [story.id, story]));
  const chaptersByStory = groupBy(input.chapters, chapter => chapter.storyId);
  const assetsByStory = groupBy(input.assets, asset => asset.storyId);
  const assetsByChapter = groupBy(input.assets.filter(asset => asset.chapterId), asset => asset.chapterId!);
  const charactersByStory = groupBy(input.characters ?? [], character => character.storyId);
  const failures: string[] = [];
  const warnings: string[] = [];

  const stories = input.stories.map(story => {
    const storyChapters = chaptersByStory.get(story.id) ?? [];
    const storyAssets = assetsByStory.get(story.id) ?? [];
    const knownSpeakers = (charactersByStory.get(story.id) ?? []).map(character => character.name ?? '').filter(Boolean);
    const chapters = storyChapters.map(chapter => {
      const chapterAssets = assetsByChapter.get(chapter.id) ?? [];
      const quality = scoreChapter(chapter, chapterAssets, knownSpeakers);
      for (const warning of quality.warnings) warnings.push(`${chapter.id}:${warning}`);
      if (!quality.ready) failures.push(`${chapter.id}:not_ready`);
      return quality;
    });
    return {
      storyId: story.id,
      title: story.title,
      chapterCount: storyChapters.length,
      assetCount: storyAssets.length,
      chapters,
    };
  });

  for (const chapter of input.chapters) {
    if (!storyById.has(chapter.storyId)) failures.push(`${chapter.id}:story_missing`);
  }

  const allChapters = stories.flatMap(story => story.chapters);
  const validGraphCount = allChapters.filter(chapter => chapter.graph.valid).length;
  const readyChapterCount = allChapters.filter(chapter => chapter.ready).length;
  return {
    version: 1,
    generatedAt: input.generatedAt,
    gitCommit: input.gitCommit,
    corpus: {
      storyCount: input.stories.length,
      chapterCount: input.chapters.length,
      assetCount: input.assets.length,
      validGraphCount,
      invalidGraphCount: input.chapters.length - validGraphCount,
      readyChapterCount,
    },
    thresholds: {
      eligibleStoriesClassified: input.stories.length > 0,
      persistedGraphsValidate: allChapters.every(chapter => chapter.graph.valid),
      referencedAssetsResolve: allChapters.every(chapter => chapter.assets.manifestComplete),
      objectFilesComplete: allChapters.every(chapter => chapter.assets.objectFilesComplete),
      failuresClassified: failures.every(Boolean),
    },
    stories,
    failures,
    warnings,
  };
}

export async function writeAIVNFusionQualityReport(
  reportPath: string,
  report: AIVNFusionQualityReport,
): Promise<string> {
  const target = resolveMigrationReportPath(reportPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
}

export async function writeAIVNFusionQualityMarkdown(
  reportPath: string,
  report: AIVNFusionQualityReport,
): Promise<string> {
  const target = resolveMigrationReportPath(reportPath);
  await mkdir(path.dirname(target), { recursive: true });
  const lines = [
    '# AIVN Fusion Quality Summary',
    '',
    `Generated: ${report.generatedAt}`,
    `Git commit: ${report.gitCommit ?? 'unknown'}`,
    '',
    `Stories: ${report.corpus.storyCount}`,
    `Chapters: ${report.corpus.chapterCount}`,
    `Assets: ${report.corpus.assetCount}`,
    `Valid graphs: ${report.corpus.validGraphCount}`,
    `Ready chapters: ${report.corpus.readyChapterCount}`,
    '',
    '## Thresholds',
    '',
    ...Object.entries(report.thresholds).map(([key, value]) => `- ${key}: ${value ? 'pass' : 'fail'}`),
    '',
    '## Failures',
    '',
    ...(report.failures.length > 0 ? report.failures.map(failure => `- ${failure}`) : ['- none']),
    '',
  ];
  await writeFile(target, `${lines.join('\n')}\n`, 'utf8');
  return target;
}

function scoreChapter(chapter: ChapterRecord, assets: AssetRecord[], knownSpeakers: string[]): AIVNFusionQualityChapter {
  const assetRecords = assets.map(asset => ({
    assetId: asset.assetId,
    scopedAssetId: asset.scopedAssetId,
    category: asset.category,
    publicUrl: asset.publicUrl,
    localPath: asset.localPath,
  }));
  const graph = chapter.graphJson as VNGraphSaveData;
  const validation = validateVNGraph(graph, {
    requireEndingTerminal: true,
    knownSpeakers,
    assetWhitelist: generatedAssetWhitelist(assetRecords),
    assetResolver: fusionQualityResourceResolver(assetRecords),
  });
  const referenced = validation.valid || graph?.Nodes
    ? collectVNGraphAssetReferences(graph)
    : [];
  const assetByScopedId = new Map(assets.map(asset => [asset.scopedAssetId, asset]));
  const missingManifestRefs = referenced.filter(scopedAssetId => !assetByScopedId.has(scopedAssetId));
  const missingObjectRefs = referenced.filter(scopedAssetId => {
    const asset = assetByScopedId.get(scopedAssetId);
    return !asset?.localPath || !existsSync(asset.localPath);
  });
  const visuals = countVisuals(graph);
  const startExists = graph?.Nodes?.some(node => Number(node.NodeType) === 1 && node.SubType === 6) ?? false;
  const terminalEndReachable = startExists ? canReachTerminalEnd(graph) : false;
  const warnings = [
    ...missingManifestRefs.map(ref => `missing_manifest_ref:${ref}`),
    ...missingObjectRefs.map(ref => `missing_object_ref:${ref}`),
    ...(validation.valid ? [] : [validation.error]),
  ].filter(Boolean);
  const ready = validation.valid && startExists && terminalEndReachable &&
    missingManifestRefs.length === 0 && missingObjectRefs.length === 0;

  return {
    chapterId: chapter.id,
    storyId: chapter.storyId,
    status: chapter.status,
    migrationRunId: chapter.migrationRunId,
    graph: {
      valid: validation.valid,
      error: validation.error,
      startExists,
      terminalEndReachable,
      nodeCount: graph?.Nodes?.length ?? 0,
    },
    assets: {
      referenced,
      manifestComplete: missingManifestRefs.length === 0,
      objectFilesComplete: missingObjectRefs.length === 0,
      missingManifestRefs,
      missingObjectRefs,
    },
    visuals,
    ready,
    warnings,
  };
}

function countVisuals(graph: VNGraphSaveData): AIVNFusionQualityChapter['visuals'] {
  const nodes = graph?.Nodes ?? [];
  const backgroundCount = collectVNGraphAssetReferences(graph).filter(ref => ref.startsWith('assets:bg.')).length;
  const tachiActionCount = nodes.filter(node => Number(node.NodeType) === 2 && node.SubType === 1).length;
  const illustrationActionCount = nodes.filter(node => Number(node.NodeType) === 2 && node.SubType === 6).length;
  const clearActionCount = nodes.filter(node => Number(node.NodeType) === 2 && (node.SubType === 33 || node.SubType === 37)).length;
  const visualHostCount = nodes.filter(node => Number(node.NodeType) === 1 &&
    (node.SubType === 1 || node.SubType === 2) &&
    Array.isArray(node.Outputs?.Actions) &&
    node.Outputs.Actions.length > 0).length;
  const progressHostCount = nodes.filter(node => Number(node.NodeType) === 1 && (node.SubType === 1 || node.SubType === 2)).length;
  return {
    backgroundCount,
    tachiActionCount,
    illustrationActionCount,
    clearActionCount,
    visualActionCoverage: progressHostCount > 0 ? Number((visualHostCount / progressHostCount).toFixed(3)) : 0,
  };
}

function canReachTerminalEnd(graph: VNGraphSaveData): boolean {
  const nodesByIndex = new Map((graph.Nodes ?? []).map(node => [node.Index, node]));
  const start = graph.StartNodeIndex;
  const pending = [start];
  const visited = new Set<number>();
  while (pending.length > 0) {
    const index = pending.pop()!;
    if (visited.has(index)) continue;
    visited.add(index);
    const node = nodesByIndex.get(index);
    if (!node) continue;
    if (Number(node.NodeType) === 1 && node.SubType === 11 && !hasProgressOutputs(node)) return true;
    for (const [key, targets] of Object.entries(node.Outputs ?? {})) {
      if (key === 'Actions' || !Array.isArray(targets)) continue;
      for (const target of targets) pending.push(target);
    }
  }
  return false;
}

function hasProgressOutputs(node: VNNodeSaveData): boolean {
  return Object.entries(node.Outputs ?? {}).some(([key, targets]) =>
    key !== 'Actions' && Array.isArray(targets) && targets.length > 0);
}

function groupBy<T>(items: T[], keySelector: (item: T) => string): Map<string, T[]> {
  const result = new Map<string, T[]>();
  for (const item of items) {
    const key = keySelector(item);
    const bucket = result.get(key) ?? [];
    bucket.push(item);
    result.set(key, bucket);
  }
  return result;
}

function fusionQualityResourceResolver(assets: VNGeneratedAssetRecord[]): VNAssetResolver {
  const assetResolver = generatedAssetResolver(assets);
  return {
    resolve(reference: string, assetType: string, category: string) {
      if (reference.startsWith('story.chapter_')) return true;
      return assetResolver.resolve(reference, assetType, category);
    },
  };
}

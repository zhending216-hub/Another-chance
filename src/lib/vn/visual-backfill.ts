import { readFile } from 'fs/promises';
import prisma from '@/lib/prisma';
import { generatedAssetResolver, generatedAssetWhitelist, type VNGeneratedAssetRecord } from './asset-bridge';
import { buildVNVisualPlacementPlan } from './visual-placement-policy';
import { orchestrateVNGraphVisuals, type VNVisualOrchestrationReport } from './visual-orchestration';
import type { VNAssetResolver, VNGraphSaveData } from './types';
import { validateVNGraph } from './validator';

export type AIVNVisualBackfillMode = 'audit' | 'dry-run' | 'persist-existing' | 'rollback';
export type AIVNVisualBackfillRisk = 'low' | 'medium' | 'high';

export interface AIVNVisualBackfillReport {
  mode: AIVNVisualBackfillMode;
  generatedAt: string;
  runId: string;
  summary: {
    chapterCount: number;
    eligibleCount: number;
    persistedCount: number;
    skippedCount: number;
    rollbackCount: number;
  };
  chapters: AIVNVisualBackfillChapterReport[];
}

export interface AIVNVisualBackfillChapterReport {
  storyId: string;
  chapterId: string;
  risk: AIVNVisualBackfillRisk;
  graphValid: boolean;
  nodeCount: number;
  compatibleTargetNodeCount: number;
  existingVisualActionCount: number;
  assetCoverage: {
    Background: number;
    Tachi: number;
    Illustration: number;
  };
  plannedPlacementCount: number;
  placementReasons: string[];
  status: 'eligible' | 'persisted' | 'skipped' | 'rolled_back';
  skipReason: string;
  previousGraphJson?: VNGraphSaveData;
  nextGraphJson?: VNGraphSaveData;
  orchestration?: VNVisualOrchestrationReport;
}

interface ChapterRecord {
  id: string;
  storyId: string;
  graphJson: unknown;
  status: string;
}

interface AssetRecord extends VNGeneratedAssetRecord {
  storyId: string;
  chapterId: string | null;
}

interface CharacterRecord {
  storyId: string;
  name: string | null;
}

export async function runAIVNVisualBackfillAudit(): Promise<AIVNVisualBackfillReport> {
  const corpus = await loadVisualBackfillCorpus();
  return buildVisualBackfillReport('audit', corpus);
}

export async function runAIVNVisualBackfillDryRun(): Promise<AIVNVisualBackfillReport> {
  const corpus = await loadVisualBackfillCorpus();
  return buildVisualBackfillReport('dry-run', corpus);
}

export async function runAIVNVisualBackfillPersistExisting(options: {
  batchSize?: number;
  risk?: AIVNVisualBackfillRisk;
  requireBackupConfirmation?: boolean;
} = {}): Promise<AIVNVisualBackfillReport> {
  if (options.requireBackupConfirmation !== true) {
    throw new Error('Refusing visual backfill persist without explicit backup confirmation.');
  }

  const corpus = await loadVisualBackfillCorpus();
  const dryRun = buildVisualBackfillReport('dry-run', corpus);
  const risk = options.risk ?? 'low';
  const batchSize = Math.max(1, Math.min(20, options.batchSize ?? 3));
  const candidates = dryRun.chapters
    .filter(chapter => chapter.status === 'eligible' && chapter.risk === risk)
    .slice(0, batchSize);
  const byChapterId = new Map(corpus.chapters.map(chapter => [chapter.id, chapter]));
  const assetsByChapter = groupBy(corpus.assets.filter(asset => asset.chapterId), asset => asset.chapterId!);
  const speakersByStory = groupBy(corpus.characters, character => character.storyId);
  const chapters: AIVNVisualBackfillChapterReport[] = [];

  for (const candidate of candidates) {
    const chapter = byChapterId.get(candidate.chapterId);
    if (!chapter) continue;
    const graph = chapter.graphJson as VNGraphSaveData;
    const assets = assetsByChapter.get(chapter.id) ?? [];
    const knownSpeakers = (speakersByStory.get(chapter.storyId) ?? []).map(character => character.name ?? '').filter(Boolean);
    const orchestration = orchestrateVNGraphVisuals({
      graph,
      assets,
      knownSpeakers,
      requireEndingTerminal: true,
    });
    if (!orchestration.validation.valid || !orchestration.graphChanged) {
      chapters.push({
        ...candidate,
        status: 'skipped',
        skipReason: orchestration.validation.valid ? 'orchestration_noop' : orchestration.validation.error,
        orchestration: orchestration.report,
      });
      continue;
    }

    await prisma.generatedVNChapter.update({
      where: { id: chapter.id },
      data: { graphJson: orchestration.graph as any },
    });
    chapters.push({
      ...candidate,
      status: 'persisted',
      skipReason: '',
      previousGraphJson: graph,
      nextGraphJson: orchestration.graph,
      orchestration: orchestration.report,
    });
  }

  return finalizeReport('persist-existing', chapters, dryRun.generatedAt, dryRun.runId);
}

export async function runAIVNVisualBackfillRollbackFromReport(reportPath: string): Promise<AIVNVisualBackfillReport> {
  const source = JSON.parse(await readFile(reportPath, 'utf8')) as AIVNVisualBackfillReport;
  const rolledBack: AIVNVisualBackfillChapterReport[] = [];
  for (const chapter of source.chapters) {
    if (chapter.status !== 'persisted' || !chapter.previousGraphJson) continue;
    await prisma.generatedVNChapter.update({
      where: { id: chapter.chapterId },
      data: { graphJson: chapter.previousGraphJson as any },
    });
    rolledBack.push({ ...chapter, status: 'rolled_back', skipReason: '' });
  }
  return finalizeReport('rollback', rolledBack, new Date().toISOString(), `${source.runId}-rollback`);
}

async function loadVisualBackfillCorpus() {
  const [chapters, assets, characters] = await Promise.all([
    prisma.generatedVNChapter.findMany({
      select: { id: true, storyId: true, graphJson: true, status: true },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.generatedAsset.findMany({
      select: {
        storyId: true,
        chapterId: true,
        assetId: true,
        scopedAssetId: true,
        category: true,
        publicUrl: true,
        localPath: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.character.findMany({
      select: { storyId: true, name: true },
      orderBy: { createdAt: 'asc' },
    }),
  ]);
  return {
    chapters: chapters as ChapterRecord[],
    assets: assets as AssetRecord[],
    characters: characters as CharacterRecord[],
  };
}

function buildVisualBackfillReport(
  mode: 'audit' | 'dry-run',
  corpus: Awaited<ReturnType<typeof loadVisualBackfillCorpus>>,
): AIVNVisualBackfillReport {
  const assetsByChapter = groupBy(corpus.assets.filter(asset => asset.chapterId), asset => asset.chapterId!);
  const speakersByStory = groupBy(corpus.characters, character => character.storyId);
  const generatedAt = new Date().toISOString();
  const runId = `visual-backfill-${generatedAt.replace(/[^0-9]/g, '').slice(0, 14)}`;
  const chapters = corpus.chapters.map(chapter => {
    const assets = assetsByChapter.get(chapter.id) ?? [];
    const knownSpeakers = (speakersByStory.get(chapter.storyId) ?? []).map(character => character.name ?? '').filter(Boolean);
    return auditChapter(chapter, assets, knownSpeakers);
  });
  return finalizeReport(mode, chapters, generatedAt, runId);
}

function auditChapter(
  chapter: ChapterRecord,
  assets: AssetRecord[],
  knownSpeakers: string[],
): AIVNVisualBackfillChapterReport {
  const graph = chapter.graphJson as VNGraphSaveData;
  const assetRecords = assets.map(toAssetRecord);
  const validation = validateVNGraph(graph, {
    requireEndingTerminal: true,
    knownSpeakers,
    assetWhitelist: generatedAssetWhitelist(assetRecords),
    assetResolver: visualBackfillResourceResolver(assetRecords),
  });
  const compatibleTargetNodeCount = (graph.Nodes ?? []).filter(node => Number(node.NodeType) === 1 && (node.SubType === 1 || node.SubType === 2)).length;
  const existingVisualActionCount = (graph.Nodes ?? []).filter(node => Number(node.NodeType) === 2 && [1, 6, 33, 37].includes(node.SubType)).length;
  const plan = buildVNVisualPlacementPlan({ graph, assets: assetRecords, knownSpeakers });
  const assetCoverage = {
    Background: assets.filter(asset => asset.category === 'Background').length,
    Tachi: assets.filter(asset => asset.category === 'Tachi').length,
    Illustration: assets.filter(asset => asset.category === 'Illustration').length,
  };
  const skipReason = !validation.valid
    ? validation.error
    : plan.placements.length === 0
      ? plan.skippedAssets.map(item => item.reason).join('; ') || 'no eligible visual assets'
      : '';
  return {
    storyId: chapter.storyId,
    chapterId: chapter.id,
    risk: assessRisk(graph, assets, existingVisualActionCount),
    graphValid: validation.valid,
    nodeCount: graph.Nodes?.length ?? 0,
    compatibleTargetNodeCount,
    existingVisualActionCount,
    assetCoverage,
    plannedPlacementCount: plan.placements.length,
    placementReasons: plan.placements.map(item => item.placementReason),
    status: validation.valid && plan.placements.length > 0 ? 'eligible' : 'skipped',
    skipReason,
  };
}

function assessRisk(graph: VNGraphSaveData, assets: AssetRecord[], existingVisualActionCount: number): AIVNVisualBackfillRisk {
  const nodeCount = graph.Nodes?.length ?? 0;
  if (nodeCount > 100 || assets.length > 12) return 'high';
  if (nodeCount > 50 || existingVisualActionCount > 0 || assets.length > 6) return 'medium';
  return 'low';
}

function finalizeReport(
  mode: AIVNVisualBackfillMode,
  chapters: AIVNVisualBackfillChapterReport[],
  generatedAt: string,
  runId: string,
): AIVNVisualBackfillReport {
  return {
    mode,
    generatedAt,
    runId,
    summary: {
      chapterCount: chapters.length,
      eligibleCount: chapters.filter(chapter => chapter.status === 'eligible').length,
      persistedCount: chapters.filter(chapter => chapter.status === 'persisted').length,
      skippedCount: chapters.filter(chapter => chapter.status === 'skipped').length,
      rollbackCount: chapters.filter(chapter => chapter.status === 'rolled_back').length,
    },
    chapters,
  };
}

function toAssetRecord(asset: AssetRecord): VNGeneratedAssetRecord {
  return {
    assetId: asset.assetId,
    scopedAssetId: asset.scopedAssetId,
    category: asset.category,
    publicUrl: asset.publicUrl,
    localPath: asset.localPath,
  };
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

function visualBackfillResourceResolver(assets: VNGeneratedAssetRecord[]): VNAssetResolver {
  const assetResolver = generatedAssetResolver(assets);
  return {
    resolve(reference: string, assetType: string, category: string) {
      if (reference.startsWith('story.chapter_')) return true;
      return assetResolver.resolve(reference, assetType, category);
    },
  };
}

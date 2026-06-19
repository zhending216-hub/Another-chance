import { createHash } from 'crypto';
import { mkdir, rm, writeFile } from 'fs/promises';
import { dirname, join } from 'path';
import JSZip from 'jszip';
import prisma from '@/lib/prisma';
import type { StoryBranch, StorySegment } from '@/lib/prisma';
import {
  buildBulkMigrationAuditReport,
  loadBulkMigrationCorpus,
  type BulkMigrationCorpus,
  type BulkStoryCorpusRecord,
} from './bulk-migration';
import { buildAIVNPackageId, collectVNGraphAssetReferences, type AIVNAssetsManifest, type AIVNBookManifest } from './aivn-package';
import {
  completeVNMigrationRun,
  computeStorySourceHash,
  failVNMigrationRun,
  startVNMigrationRun,
} from './migration-run';
import type { BulkAuditStoryReport } from './migration-report';
import type { VNAssetResolver, VNAssetWhitelist, VNGraphSaveData, VNGraphValidationOptions, VNNodeSaveData, VNSerializedValue } from './types';
import { validateVNGraph } from './validator';

export const PHASE9_MIGRATION_KIND = 'story-tree-split-v1';
export const PHASE9_CONVERTER_VERSION = 'phase9-split-v1';
export const PHASE9_ENTRY_CHAPTER_ASSET_ID = 'story.chapter_001';
export const PHASE9_ENTRY_STORAGE_BRANCH_ID = 'migration-phase9:story.chapter_001';

const SUPPORTED_SKIP_REASONS = new Set([
  'nested_branch_source_requires_chapter_handoff',
  'missing_parent_segment',
]);

export interface Phase9ChapterPlan {
  assetId: string;
  file: string;
  sourceBranchId: string | null;
  sourceSegmentId: string | null;
}

export interface Phase9StoryPlan {
  storyId: string;
  strategy: string;
  chapters: Phase9ChapterPlan[];
  handoffBranchIds: string[];
  missingParentSegmentIds: string[];
}

export interface Phase9ChapterResult extends Phase9ChapterPlan {
  graph: VNGraphSaveData;
  validation: ReturnType<typeof validateVNGraph>;
}

export interface Phase9ConversionResult {
  storyId: string;
  plan: Phase9StoryPlan;
  chapters: Phase9ChapterResult[];
  validation: ReturnType<typeof validateVNGraph>;
}

export interface Phase9StoryReport {
  storyId: string;
  title: string;
  status: 'target' | 'valid' | 'invalid' | 'persisted' | 'skipped' | 'duplicate';
  strategy: string;
  segmentCount: number;
  branchCount: number;
  skipReasons: string[];
  warnings: string[];
  handoffBranchCount: number;
  missingParentSegmentCount: number;
  chapterCount: number;
  nodeCount: number | null;
  validationErrors: string[];
  sourceHash?: string | null;
  migrationRunId?: string | null;
  persistedChapterIds?: string[];
  packageId?: string;
  folderPath?: string;
  zipPath?: string;
  error?: string;
}

export interface Phase9Report {
  mode: 'phase9-audit' | 'phase9-dry-run' | 'phase9-persist' | 'phase9-export';
  generatedAt: string;
  converterVersion: string;
  migrationRunId?: string;
  summary: {
    storyCount: number;
    targetStoryCount: number;
    validStoryCount: number;
    invalidStoryCount: number;
    persistedStoryCount: number;
    skippedStoryCount: number;
    duplicateStoryCount: number;
    chapterCount: number;
    handoffBranchCount: number;
    missingParentSegmentCount: number;
    packageCount?: number;
  };
  stories: Phase9StoryReport[];
}

export async function runPhase9Audit(): Promise<Phase9Report> {
  return buildPhase9AuditReport(await loadBulkMigrationCorpus());
}

export async function runPhase9DryRun(): Promise<Phase9Report> {
  return buildPhase9DryRunReport(await loadBulkMigrationCorpus());
}

export async function runPhase9Persist(options: { reportPath?: string | null } = {}): Promise<Phase9Report> {
  const corpus = await loadBulkMigrationCorpus();
  const generatedAt = new Date().toISOString();
  const dryRun = buildPhase9DryRunReport(corpus, generatedAt);
  const candidates = dryRun.stories.filter(story => story.status === 'valid');
  const recordsByStoryId = new Map(corpus.stories.map(record => [record.story.id, record]));

  const run = await startVNMigrationRun({
    mode: 'phase9:persist',
    dryRun: false,
    storyCount: candidates.length,
    segmentCount: candidates.reduce((sum, story) => sum + story.segmentCount, 0),
    branchCount: candidates.reduce((sum, story) => sum + story.branchCount, 0),
    reportPath: options.reportPath ?? null,
  });

  const stories: Phase9StoryReport[] = [];
  let validCount = 0;
  let invalidCount = 0;
  let skippedCount = 0;

  try {
    for (const candidate of candidates) {
      const record = recordsByStoryId.get(candidate.storyId);
      if (!record) {
        invalidCount += 1;
        stories.push({ ...candidate, status: 'invalid', validationErrors: ['story_record_missing'] });
        continue;
      }

      const sourceHash = computeStorySourceHash(record, PHASE9_CONVERTER_VERSION);
      const existing = await prisma.generatedVNChapter.findFirst({
        where: { storyId: record.story.id, migrationKind: PHASE9_MIGRATION_KIND, sourceHash },
        select: { id: true },
      });
      if (existing) {
        skippedCount += 1;
        stories.push({
          ...candidate,
          status: 'duplicate',
          sourceHash,
          migrationRunId: run.id,
          persistedChapterIds: [existing.id],
          validationErrors: ['duplicate_source_hash'],
        });
        continue;
      }

      const conversion = convertStoryTreeToPhase9Chapters(record);
      if (!conversion.validation.valid) {
        invalidCount += 1;
        stories.push({
          ...candidate,
          status: 'invalid',
          sourceHash,
          migrationRunId: run.id,
          nodeCount: totalNodeCount(conversion.chapters),
          validationErrors: validationErrors(conversion.validation),
        });
        continue;
      }

      const created = await prisma.$transaction(conversion.chapters.map(chapter => (
        prisma.generatedVNChapter.create({
          data: {
            storyId: record.story.id,
            branchId: phase9StorageBranchIdForAsset(chapter.assetId),
            sourceSegmentId: chapter.sourceSegmentId,
            graphJson: chapter.graph as any,
            rawAIText: 'Phase 9 deterministic split migration.',
            status: 'valid',
            validationError: null,
            repairAttempts: 0,
            createdById: record.story.ownerId,
            migrationRunId: run.id,
            migrationKind: PHASE9_MIGRATION_KIND,
            sourceHash,
          },
        })
      )));

      const revalidationOptions = phase9ChapterValidationOptions(conversion.chapters);
      const revalidations = created.map(chapter => validateVNGraph(
        chapter.graphJson as unknown as VNGraphSaveData,
        revalidationOptions,
      ));
      const failed = revalidations.find(result => !result.valid);
      if (failed) {
        invalidCount += 1;
      } else {
        validCount += 1;
      }

      stories.push({
        ...candidate,
        status: failed ? 'invalid' : 'persisted',
        sourceHash,
        migrationRunId: run.id,
        persistedChapterIds: created.map(chapter => chapter.id),
        validationErrors: failed ? validationErrors(failed) : [],
      });
    }

    await completeVNMigrationRun(run.id, {
      validCount,
      invalidCount,
      skippedCount,
      reportPath: options.reportPath ?? null,
    });
  } catch (error) {
    await failVNMigrationRun(run.id, {
      validCount,
      invalidCount,
      skippedCount,
      reportPath: options.reportPath ?? null,
      errorSummary: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }

  return {
    mode: 'phase9-persist',
    generatedAt,
    converterVersion: PHASE9_CONVERTER_VERSION,
    migrationRunId: run.id,
    summary: buildPhase9Summary(corpus.stories.length, stories),
    stories,
  };
}

export async function runPhase9Export(options: { migrationRunId: string; format: 'folder' | 'zip' }): Promise<Phase9Report> {
  const generatedAt = new Date().toISOString();
  const chapters = await prisma.generatedVNChapter.findMany({
    where: { migrationRunId: options.migrationRunId, migrationKind: PHASE9_MIGRATION_KIND },
    orderBy: [{ storyId: 'asc' }, { createdAt: 'asc' }],
  });
  const storyIds = [...new Set(chapters.map(chapter => chapter.storyId))];
  const stories = await prisma.story.findMany({ where: { id: { in: storyIds } } });
  const storyById = new Map(stories.map(story => [story.id, story]));
  const chaptersByStoryId = groupBy(chapters, chapter => chapter.storyId);
  const reports: Phase9StoryReport[] = [];

  for (const [storyId, storyChapters] of chaptersByStoryId) {
    const story = storyById.get(storyId);
    if (!story) {
      reports.push({
        storyId,
        title: '',
        status: 'invalid',
        strategy: 'export_phase9_package',
        segmentCount: 0,
        branchCount: 0,
        skipReasons: [],
        warnings: [],
        handoffBranchCount: 0,
        missingParentSegmentCount: 0,
        chapterCount: storyChapters.length,
        nodeCount: null,
        validationErrors: ['story_missing_for_export'],
      });
      continue;
    }

    const pkg = await buildPhase9AIVNPackage({
      story,
      chapters: storyChapters,
      migrationRunId: options.migrationRunId,
      format: options.format,
    });
    reports.push({
      storyId,
      title: story.title,
      status: 'valid',
      strategy: 'export_phase9_package',
      segmentCount: 0,
      branchCount: 0,
      skipReasons: [],
      warnings: [],
      handoffBranchCount: pkg.chapterAssetIds.length - 1,
      missingParentSegmentCount: 0,
      chapterCount: pkg.chapterAssetIds.length,
      nodeCount: pkg.nodeCount,
      validationErrors: [],
      migrationRunId: options.migrationRunId,
      packageId: pkg.packageId,
      folderPath: pkg.folderPath,
      zipPath: pkg.zipPath,
    });
  }

  return {
    mode: 'phase9-export',
    generatedAt,
    converterVersion: PHASE9_CONVERTER_VERSION,
    migrationRunId: options.migrationRunId,
    summary: { ...buildPhase9Summary(storyIds.length, reports), packageCount: reports.filter(story => story.status === 'valid').length },
    stories: reports,
  };
}

export function buildPhase9AuditReport(corpus: BulkMigrationCorpus, generatedAt = new Date().toISOString()): Phase9Report {
  const targets = collectPhase9Targets(corpus, generatedAt);
  const stories = targets.map(({ record, auditStory }) => {
    const plan = convertStoryRecordToPhase9Plan(record, auditStory);
    return baseStoryReport(record, auditStory, plan, 'target');
  });
  return {
    mode: 'phase9-audit',
    generatedAt,
    converterVersion: PHASE9_CONVERTER_VERSION,
    summary: buildPhase9Summary(corpus.stories.length, stories),
    stories,
  };
}

export function buildPhase9DryRunReport(corpus: BulkMigrationCorpus, generatedAt = new Date().toISOString()): Phase9Report {
  const targets = collectPhase9Targets(corpus, generatedAt);
  const stories = targets.map(({ record, auditStory }) => {
    const plan = convertStoryRecordToPhase9Plan(record, auditStory);
    const base = baseStoryReport(record, auditStory, plan, 'valid');
    try {
      const conversion = convertStoryTreeToPhase9Chapters(record, auditStory);
      return {
        ...base,
        status: conversion.validation.valid ? 'valid' : 'invalid',
        chapterCount: conversion.chapters.length,
        nodeCount: totalNodeCount(conversion.chapters),
        validationErrors: conversion.validation.valid ? [] : validationErrors(conversion.validation),
      } satisfies Phase9StoryReport;
    } catch (error) {
      return {
        ...base,
        status: 'invalid',
        validationErrors: [error instanceof Error ? error.message : String(error)],
        error: error instanceof Error ? error.message : String(error),
      } satisfies Phase9StoryReport;
    }
  });
  return {
    mode: 'phase9-dry-run',
    generatedAt,
    converterVersion: PHASE9_CONVERTER_VERSION,
    summary: buildPhase9Summary(corpus.stories.length, stories),
    stories,
  };
}

export function convertStoryRecordToPhase9Plan(
  record: BulkStoryCorpusRecord,
  auditStory?: BulkAuditStoryReport,
): Phase9StoryPlan {
  const segmentsById = new Map(record.segments.map(segment => [segment.id, segment]));
  const handoffBranches = record.branches.filter(branch => {
    const source = segmentsById.get(branch.sourceSegmentId);
    return source?.storyId === record.story.id && source.branchId !== 'main';
  });
  const missingParentSegmentIds = record.segments
    .filter(segment => segment.parentSegmentId && !segmentsById.has(segment.parentSegmentId))
    .map(segment => segment.id);
  const chapters: Phase9ChapterPlan[] = [{
    assetId: PHASE9_ENTRY_CHAPTER_ASSET_ID,
    file: phase9ChapterFile(PHASE9_ENTRY_CHAPTER_ASSET_ID),
    sourceBranchId: null,
    sourceSegmentId: firstMainSegment(record)?.id ?? record.story.rootSegmentId ?? null,
  }];

  for (const branch of handoffBranches) {
    const assetId = phase9BranchChapterAssetId(branch.id);
    chapters.push({
      assetId,
      file: phase9ChapterFile(assetId),
      sourceBranchId: branch.id,
      sourceSegmentId: branch.sourceSegmentId,
    });
  }

  return {
    storyId: record.story.id,
    strategy: strategyFor(auditStory?.skipReasons ?? [], handoffBranches.length, missingParentSegmentIds.length),
    chapters,
    handoffBranchIds: handoffBranches.map(branch => branch.id),
    missingParentSegmentIds,
  };
}

export function convertStoryTreeToPhase9Chapters(
  record: BulkStoryCorpusRecord,
  auditStory?: BulkAuditStoryReport,
): Phase9ConversionResult {
  const plan = convertStoryRecordToPhase9Plan(record, auditStory);
  const handoffAssetByBranchId = new Map(plan.handoffBranchIds.map(branchId => [branchId, phase9BranchChapterAssetId(branchId)]));
  const chapters: Phase9ChapterResult[] = [];

  chapters.push({
    ...plan.chapters[0],
    graph: buildGraphForChapter(record, { rootBranchId: null, handoffAssetByBranchId }),
    validation: { valid: false, error: 'not_validated', errors: ['not_validated'] },
  });

  for (const branchId of plan.handoffBranchIds) {
    const chapterPlan = plan.chapters.find(chapter => chapter.sourceBranchId === branchId);
    if (!chapterPlan) continue;
    chapters.push({
      ...chapterPlan,
      graph: buildGraphForChapter(record, { rootBranchId: branchId, handoffAssetByBranchId }),
      validation: { valid: false, error: 'not_validated', errors: ['not_validated'] },
    });
  }

  const validationOptions = phase9ChapterValidationOptions(chapters);
  let aggregate: ReturnType<typeof validateVNGraph> = { valid: true, error: '', errors: [] };
  for (const chapter of chapters) {
    chapter.validation = validateVNGraph(chapter.graph, validationOptions);
    if (!chapter.validation.valid && aggregate.valid) aggregate = chapter.validation;
  }

  return { storyId: record.story.id, plan, chapters, validation: aggregate };
}

export function phase9BranchChapterAssetId(branchId: string): string {
  return `story.chapter_branch_${safeName(branchId)}`;
}

export function phase9StorageBranchIdForAsset(assetId: string): string {
  return `migration-phase9:${assetId}`;
}

export function phase9AssetIdFromStorageBranchId(branchId: string): string {
  return branchId.startsWith('migration-phase9:') ? branchId.slice('migration-phase9:'.length) : branchId;
}

export function phase9ChapterFile(assetId: string): string {
  if (assetId === PHASE9_ENTRY_CHAPTER_ASSET_ID) return 'chapter_001.json';
  return `${safeName(assetId.replace(/^story\./, ''))}.json`;
}

export function phase9ChapterValidationOptions(chapters: Array<Pick<Phase9ChapterPlan, 'assetId' | 'file'>>): VNGraphValidationOptions {
  const filesByAssetId = new Map(chapters.map(chapter => [chapter.assetId, chapter.file]));
  const whitelist: VNAssetWhitelist = { contains: (_category, scopedAssetId) => filesByAssetId.has(scopedAssetId) };
  const resolver: VNAssetResolver = {
    resolve(scopedAssetId, _assetType, category) {
      if (category !== 'Chapter') return false;
      const file = filesByAssetId.get(scopedAssetId);
      return file ? `Chapters/${file}` : false;
    },
  };
  return { requireEndingTerminal: true, assetWhitelist: whitelist, assetResolver: resolver };
}

export async function buildPhase9AIVNPackage(options: {
  story: { id: string; title: string; ownerId: string; description?: string | null; genre?: string | null; era?: string | null };
  chapters: Array<{ id: string; branchId: string; graphJson: unknown; sourceHash: string | null; createdAt: Date }>;
  migrationRunId: string;
  format: 'folder' | 'zip';
}): Promise<{ packageId: string; chapterAssetIds: string[]; nodeCount: number; folderPath?: string; zipPath?: string }> {
  const packageId = buildAIVNPackageId(options.story.id);
  const entries = options.chapters.map(chapter => {
    const assetId = phase9AssetIdFromStorageBranchId(chapter.branchId);
    const graph = chapter.graphJson as VNGraphSaveData;
    const file = phase9ChapterFile(assetId);
    const json = stringifyJson(graph);
    return { chapter, assetId, graph, file, json, hash: sha256Text(json) };
  }).sort((left, right) => chapterSortKey(left.assetId).localeCompare(chapterSortKey(right.assetId)));
  if (!entries.some(entry => entry.assetId === PHASE9_ENTRY_CHAPTER_ASSET_ID)) {
    throw new Error(`Phase 9 package is missing entry chapter: ${options.story.id}`);
  }

  const validationOptions = phase9ChapterValidationOptions(entries);
  const validations = entries.map(entry => ({ assetId: entry.assetId, ...validateVNGraph(entry.graph, validationOptions) }));
  const invalid = validations.find(result => !result.valid);
  if (invalid) throw new Error(`Stored Phase 9 chapter is invalid (${invalid.assetId}): ${invalid.error}`);

  const assets: AIVNBookManifest['assets'] = {};
  const files: Record<string, unknown> = {};
  for (const entry of entries) {
    assets[entry.assetId] = {
      type: 'story',
      category: 'chapter',
      path: `Chapters/${entry.file}`,
      hash: `sha256-${entry.hash}`,
    };
    files[`Books/${packageId}/Chapters/${entry.file}`] = entry.graph;
  }

  const usedAssets = [...new Set(entries.flatMap(entry => collectVNGraphAssetReferences(entry.graph)))].sort();
  const manifest: AIVNBookManifest = {
    package_id: packageId,
    namespace: packageId,
    title: options.story.title,
    author_id: `server:${options.story.ownerId}`,
    type: 'story',
    version: '0.1.0',
    entry_story: PHASE9_ENTRY_CHAPTER_ASSET_ID,
    assets,
    used_assets: usedAssets,
    metadata: {
      source: 'gushi',
      source_story_id: options.story.id,
      source_migration_run_id: options.migrationRunId,
      source_migration_kind: PHASE9_MIGRATION_KIND,
      chapter_count: String(entries.length),
    },
  };
  const assetsManifest: AIVNAssetsManifest = {
    package_id: `${packageId}_assets`,
    namespace: 'assets',
    title: `${options.story.title} Assets`,
    type: 'assets',
    version: '0.1.0',
    assets: {},
  };
  files[`Books/${packageId}/manifest.json`] = manifest;
  files['assets_manifest.json'] = assetsManifest;
  files['import-report.json'] = {
    source: 'gushi',
    source_story_id: options.story.id,
    target_package_id: packageId,
    target_chapter_asset_ids: entries.map(entry => entry.assetId),
    copied_asset_count: 0,
    skipped_asset_count: 0,
    graph_rewrite_count: 0,
    validation: { valid: true, error: '', errors: [] },
  };
  files['validation-report.json'] = { valid: true, error: '', errors: [], chapters: validations, usedAssets };
  files['metadata.json'] = {
    version: 1,
    exportedAt: new Date().toISOString(),
    source: 'gushi',
    story: options.story,
    migrationRunId: options.migrationRunId,
    migrationKind: PHASE9_MIGRATION_KIND,
    chapters: entries.map(entry => ({
      id: entry.chapter.id,
      assetId: entry.assetId,
      branchId: entry.chapter.branchId,
      sourceHash: entry.chapter.sourceHash,
      createdAt: entry.chapter.createdAt,
    })),
  };

  const result = {
    packageId,
    chapterAssetIds: entries.map(entry => entry.assetId),
    nodeCount: entries.reduce((sum, entry) => sum + entry.graph.Nodes.length, 0),
  };
  if (options.format === 'zip') {
    return { ...result, zipPath: await writePhase9ZipExport(packageId, options.migrationRunId, files) };
  }
  return { ...result, folderPath: await writePhase9FolderExport(packageId, options.migrationRunId, files) };
}

function collectPhase9Targets(corpus: BulkMigrationCorpus, generatedAt: string) {
  const audit = buildBulkMigrationAuditReport(corpus, { generatedAt });
  const recordsByStoryId = new Map(corpus.stories.map(record => [record.story.id, record]));
  return audit.stories
    .filter(story => story.status === 'skipped')
    .filter(story => story.skipReasons.length > 0 && story.skipReasons.every(reason => SUPPORTED_SKIP_REASONS.has(reason)))
    .map(auditStory => ({ auditStory, record: recordsByStoryId.get(auditStory.storyId)! }))
    .filter(target => Boolean(target.record));
}

function baseStoryReport(
  record: BulkStoryCorpusRecord,
  auditStory: BulkAuditStoryReport,
  plan: Phase9StoryPlan,
  status: Phase9StoryReport['status'],
): Phase9StoryReport {
  return {
    storyId: record.story.id,
    title: record.story.title,
    status,
    strategy: plan.strategy,
    segmentCount: record.segments.length,
    branchCount: record.branches.length,
    skipReasons: auditStory.skipReasons,
    warnings: auditStory.warnings,
    handoffBranchCount: plan.handoffBranchIds.length,
    missingParentSegmentCount: plan.missingParentSegmentIds.length,
    chapterCount: plan.chapters.length,
    nodeCount: null,
    validationErrors: [],
  };
}

function buildGraphForChapter(
  record: BulkStoryCorpusRecord,
  options: { rootBranchId: string | null; handoffAssetByBranchId: Map<string, string> },
): VNGraphSaveData {
  const branchesById = new Map(record.branches.map(branch => [branch.id, branch]));
  const includedBranchIds = options.rootBranchId
    ? new Set([options.rootBranchId])
    : new Set(record.branches
        .filter(branch => sourceSegment(record, branch)?.branchId === 'main')
        .map(branch => branch.id));
  const chains: Array<{ key: string; branchId: string | null; segments: StorySegment[] }> = [];
  if (!options.rootBranchId) chains.push({ key: 'main', branchId: null, segments: orderedMainChain(record) });
  for (const branchId of includedBranchIds) {
    const branch = branchesById.get(branchId);
    if (branch) chains.push({ key: branch.id, branchId: branch.id, segments: orderedBranchChain(record, branch) });
  }

  const nodes: VNNodeSaveData[] = [];
  let nextIndex = 1;
  const startIndex = nextIndex++;
  nodes.push(startNode(startIndex));
  const branchFirstIndexes = new Map<string, number>();
  const chainNodeIndexes = new Map<string, number[]>();

  for (let chainIndex = 0; chainIndex < chains.length; chainIndex++) {
    const chain = chains[chainIndex];
    const indexes: number[] = [];
    for (const segment of chain.segments) {
      const index = nextIndex++;
      indexes.push(index);
      if (chain.branchId && !branchFirstIndexes.has(chain.branchId)) branchFirstIndexes.set(chain.branchId, index);
      nodes.push(paragraphNode(index, segment.content, 260 + nodes.length * 220, chain.branchId ? 360 + chainIndex * 180 : 120));
    }
    chainNodeIndexes.set(chain.key, indexes);
  }

  const endIndex = nextIndex++;
  nodes.push(endNode(endIndex, 260 + nodes.length * 220, 120));
  const nodeByIndex = new Map(nodes.map(node => [node.Index, node]));
  const firstChain = chains[0];
  const firstIndex = firstChain ? chainNodeIndexes.get(firstChain.key)?.[0] : undefined;
  nodeByIndex.get(startIndex)!.Outputs.Next = [firstIndex ?? endIndex];
  const branchesBySource = groupBy(record.branches, branch => branch.sourceSegmentId);

  for (const chain of chains) {
    const indexes = chainNodeIndexes.get(chain.key) ?? [];
    for (let i = 0; i < chain.segments.length; i++) {
      const segment = chain.segments[i];
      const node = nodeByIndex.get(indexes[i])!;
      const nextProgressIndex = indexes[i + 1] ?? endIndex;
      const sourceBranches = branchesBySource.get(segment.id) ?? [];
      const inlineBranches = sourceBranches.filter(branch => branchFirstIndexes.has(branch.id));
      const handoffBranches = sourceBranches.filter(branch => options.handoffAssetByBranchId.has(branch.id) && !branchFirstIndexes.has(branch.id));
      if (inlineBranches.length === 0 && handoffBranches.length === 0) {
        node.Outputs.Next = [nextProgressIndex];
        continue;
      }

      const choiceIndex = nextIndex++;
      const choiceOptions = [...inlineBranches, ...handoffBranches].map(branch => optionObject(branch.userDirection || branch.title));
      choiceOptions.push(optionObject('Continue'));
      const choice = choiceNode(choiceIndex, choiceOptions, node.X + 180, node.Y + 140);
      nodes.push(choice);
      nodeByIndex.set(choiceIndex, choice);
      node.Outputs.Next = [choiceIndex];

      let optionIndex = 0;
      for (const branch of inlineBranches) {
        choice.Outputs[`Options[${optionIndex}].Next`] = [branchFirstIndexes.get(branch.id)!];
        optionIndex += 1;
      }
      for (const branch of handoffBranches) {
        const chapterIndex = nextIndex++;
        const chapter = chapterNode(chapterIndex, options.handoffAssetByBranchId.get(branch.id)!, choice.X + 180, choice.Y + 120 + optionIndex * 80, endIndex);
        nodes.push(chapter);
        nodeByIndex.set(chapterIndex, chapter);
        choice.Outputs[`Options[${optionIndex}].Next`] = [chapterIndex];
        optionIndex += 1;
      }
      choice.Outputs[`Options[${optionIndex}].Next`] = [nextProgressIndex];
    }
  }

  return { Version: 1, StartNodeIndex: startIndex, Nodes: nodes };
}

function orderedMainChain(record: BulkStoryCorpusRecord): StorySegment[] {
  const main = sortedSegments(record.segments.filter(segment => segment.branchId === 'main'));
  return orderedChain(main, record.story.rootSegmentId ?? null);
}

function orderedBranchChain(record: BulkStoryCorpusRecord, branch: StoryBranch): StorySegment[] {
  const segments = sortedSegments(record.segments.filter(segment => segment.branchId === branch.id));
  return orderedChain(segments, null, branch.sourceSegmentId);
}

function orderedChain(segments: StorySegment[], preferredStartId: string | null, sourceParentId?: string): StorySegment[] {
  if (segments.length === 0) return [];
  const byId = new Map(segments.map(segment => [segment.id, segment]));
  let current = preferredStartId ? byId.get(preferredStartId) : undefined;
  current ??= sourceParentId ? segments.find(segment => segment.parentSegmentId === sourceParentId) : undefined;
  current ??= segments.find(segment => !segment.parentSegmentId);
  current ??= segments.find(segment => segment.parentSegmentId && !byId.has(segment.parentSegmentId));
  current ??= segments[0];

  const chain: StorySegment[] = [];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current);
    current = segments.find(segment => segment.parentSegmentId === current!.id);
  }
  for (const segment of segments) {
    if (!visited.has(segment.id)) chain.push(segment);
  }
  return chain;
}

function firstMainSegment(record: BulkStoryCorpusRecord): StorySegment | null {
  return orderedMainChain(record)[0] ?? null;
}

function sourceSegment(record: BulkStoryCorpusRecord, branch: StoryBranch): StorySegment | undefined {
  return record.segments.find(segment => segment.id === branch.sourceSegmentId);
}

function sortedSegments(segments: StorySegment[]): StorySegment[] {
  return [...segments].sort((left, right) => compareDate(left.createdAt, right.createdAt) || left.id.localeCompare(right.id));
}

function compareDate(left: Date, right: Date): number {
  return new Date(left).getTime() - new Date(right).getTime();
}

function strategyFor(skipReasons: string[], handoffCount: number, missingParentCount: number): string {
  if (handoffCount > 0 && missingParentCount > 0) return 'chapter_node_handoff_and_missing_parent_recovery';
  if (handoffCount > 0 || skipReasons.includes('nested_branch_source_requires_chapter_handoff')) return 'chapter_node_handoff_for_nested_branch_sources';
  if (missingParentCount > 0 || skipReasons.includes('missing_parent_segment')) return 'deterministic_missing_parent_recovery';
  return 'phase9_supported_skipped_story';
}

function buildPhase9Summary(storyCount: number, stories: Phase9StoryReport[]): Phase9Report['summary'] {
  return {
    storyCount,
    targetStoryCount: stories.length,
    validStoryCount: stories.filter(story => story.status === 'valid').length,
    invalidStoryCount: stories.filter(story => story.status === 'invalid').length,
    persistedStoryCount: stories.filter(story => story.status === 'persisted').length,
    skippedStoryCount: stories.filter(story => story.status === 'skipped').length,
    duplicateStoryCount: stories.filter(story => story.status === 'duplicate').length,
    chapterCount: stories.reduce((sum, story) => sum + story.chapterCount, 0),
    handoffBranchCount: stories.reduce((sum, story) => sum + story.handoffBranchCount, 0),
    missingParentSegmentCount: stories.reduce((sum, story) => sum + story.missingParentSegmentCount, 0),
  };
}

function validationErrors(result: ReturnType<typeof validateVNGraph>): string[] {
  return result.errors.length > 0 ? result.errors : [result.error];
}

function totalNodeCount(chapters: Array<{ graph: VNGraphSaveData }>): number {
  return chapters.reduce((sum, chapter) => sum + chapter.graph.Nodes.length, 0);
}

function startNode(index: number): VNNodeSaveData {
  return { Index: index, DisplayName: 'Start', Comment: '', NodeType: 1, SubType: 6, X: 80, Y: 120, Data: {}, Outputs: { Next: [] } };
}

function paragraphNode(index: number, text: string, x: number, y: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: 1,
    SubType: 2,
    X: x,
    Y: y,
    Data: { Lines: listValue([objectValue({ SpeakerId: stringValue(''), Text: stringValue(text), VoiceId: stringValue('') })]) },
    Outputs: { Actions: [], Next: [] },
  };
}

function choiceNode(index: number, options: VNSerializedValue[], x: number, y: number): VNNodeSaveData {
  return { Index: index, DisplayName: '', Comment: '', NodeType: 1, SubType: 5, X: x, Y: y, Data: { Options: listValue(options) }, Outputs: {} };
}

function chapterNode(index: number, nextChapterPath: string, x: number, y: number, endIndex: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: 'Chapter',
    Comment: '',
    NodeType: 1,
    SubType: 3,
    X: x,
    Y: y,
    Data: { NextChapterPath: stringValue(nextChapterPath) },
    Outputs: { Next: [endIndex] },
  };
}

function endNode(index: number, x: number, y: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: 'End',
    Comment: '',
    NodeType: 1,
    SubType: 11,
    X: x,
    Y: y,
    Data: { EndingId: stringValue(''), Title: stringValue(''), Subtitle: stringValue('') },
    Outputs: {},
  };
}

function optionObject(text: string): VNSerializedValue {
  return objectValue({ Text: stringValue(text || 'Continue') });
}

function stringValue(value: string): VNSerializedValue {
  return { Kind: 'String', StringValue: value };
}

function listValue(items: VNSerializedValue[]): VNSerializedValue {
  return { Kind: 'List', Items: items };
}

function objectValue(value: Record<string, VNSerializedValue>): VNSerializedValue {
  return { Kind: 'Object', ObjectValue: value };
}

function groupBy<T>(items: T[], keySelector: (item: T) => string): Map<string, T[]> {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const key = keySelector(item);
    const list = grouped.get(key) ?? [];
    list.push(item);
    grouped.set(key, list);
  }
  return grouped;
}

async function writePhase9FolderExport(packageId: string, runId: string, files: Record<string, unknown>): Promise<string> {
  const root = join(process.cwd(), 'exports', 'aivn-migration', 'packages', `${safeName(packageId)}-${safeName(runId)}-phase9`);
  await rm(root, { recursive: true, force: true });
  await mkdir(root, { recursive: true });
  for (const [filePath, value] of Object.entries(files)) {
    const target = join(root, filePath);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, stringifyJson(value), 'utf8');
  }
  return root;
}

async function writePhase9ZipExport(packageId: string, runId: string, files: Record<string, unknown>): Promise<string> {
  const root = join(process.cwd(), 'exports', 'aivn-migration', 'packages');
  await mkdir(root, { recursive: true });
  const zipPath = join(root, `${safeName(packageId)}-${safeName(runId)}-phase9.zip`);
  const zip = new JSZip();
  for (const [filePath, value] of Object.entries(files)) zip.file(filePath, stringifyJson(value));
  await writeFile(zipPath, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  return zipPath;
}

function stringifyJson(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function safeName(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, '_').replace(/_+/g, '_').replace(/^_+|_+$/g, '').slice(0, 80) || 'item';
}

function chapterSortKey(assetId: string): string {
  return assetId === PHASE9_ENTRY_CHAPTER_ASSET_ID ? '000-entry' : assetId;
}

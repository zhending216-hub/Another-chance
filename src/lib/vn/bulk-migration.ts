import prisma from '@/lib/prisma';
import type { Story, StoryBranch, StorySegment } from '@/lib/prisma';
import { convertStoryTreeToVNGraph } from './tree-migration';
import { validateVNGraph } from './validator';
import {
  BULK_MIGRATION_CONVERTER_VERSION,
  type BulkAuditReport,
  type BulkAuditStoryReport,
  type BulkDryRunReport,
  type BulkDryRunStoryReport,
  type BulkMigrationAnomalyCounts,
  type BulkMigrationRiskCounts,
  type BulkMigrationSummary,
  type BulkStoryAnomalyCounts,
  type BulkStoryRisk,
  emptyAnomalyCounts,
} from './migration-report';

export interface BulkMigrationRiskLimits {
  lowSegmentLimit: number;
  lowBranchLimit: number;
  highNodeLimit: number;
}

export const DEFAULT_BULK_MIGRATION_RISK_LIMITS: BulkMigrationRiskLimits = {
  lowSegmentLimit: 20,
  lowBranchLimit: 5,
  highNodeLimit: 120,
};

export interface GeneratedVNChapterSummary {
  id: string;
  storyId: string;
  branchId: string;
  status: string;
  createdAt: Date;
}

export interface BulkStoryCorpusRecord {
  story: Story;
  segments: StorySegment[];
  branches: StoryBranch[];
  generatedVNChapters: GeneratedVNChapterSummary[];
}

export interface BulkMigrationCorpus {
  stories: BulkStoryCorpusRecord[];
  generatedVNChapterCount: number;
  generatedAssetCount: number;
}

export interface BulkMigrationBuildOptions {
  generatedAt?: string;
  riskLimits?: BulkMigrationRiskLimits;
}

interface CorpusIndexes {
  segmentsById: Map<string, StorySegment>;
  branchesById: Map<string, StoryBranch>;
}

export async function loadBulkMigrationCorpus(): Promise<BulkMigrationCorpus> {
  const [stories, segments, branches, generatedVNChapters, generatedAssetCount] = await Promise.all([
    prisma.story.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.storySegment.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.storyBranch.findMany({ orderBy: { createdAt: 'asc' } }),
    prisma.generatedVNChapter.findMany({
      select: {
        id: true,
        storyId: true,
        branchId: true,
        status: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'asc' },
    }),
    prisma.generatedAsset.count(),
  ]);

  const segmentsByStoryId = groupBy(segments, segment => segment.storyId);
  const branchesByStoryId = groupBy(branches, branch => branch.storyId);
  const chaptersByStoryId = groupBy(generatedVNChapters, chapter => chapter.storyId);

  return {
    generatedVNChapterCount: generatedVNChapters.length,
    generatedAssetCount,
    stories: stories.map(story => ({
      story,
      segments: segmentsByStoryId.get(story.id) ?? [],
      branches: branchesByStoryId.get(story.id) ?? [],
      generatedVNChapters: chaptersByStoryId.get(story.id) ?? [],
    })),
  };
}

export async function runBulkMigrationAudit(options: BulkMigrationBuildOptions = {}): Promise<BulkAuditReport> {
  return buildBulkMigrationAuditReport(await loadBulkMigrationCorpus(), options);
}

export async function runBulkMigrationDryRun(options: BulkMigrationBuildOptions = {}): Promise<BulkDryRunReport> {
  return buildBulkMigrationDryRunReport(await loadBulkMigrationCorpus(), options);
}

export function buildBulkMigrationAuditReport(
  corpus: BulkMigrationCorpus,
  options: BulkMigrationBuildOptions = {},
): BulkAuditReport {
  const indexes = buildCorpusIndexes(corpus);
  const riskLimits = options.riskLimits ?? DEFAULT_BULK_MIGRATION_RISK_LIMITS;
  const stories = corpus.stories.map(record => auditStory(record, indexes, riskLimits));

  return {
    mode: 'audit',
    generatedAt: options.generatedAt ?? new Date().toISOString(),
    converterVersion: BULK_MIGRATION_CONVERTER_VERSION,
    summary: buildSummary(corpus, stories),
    stories,
  };
}

export function buildBulkMigrationDryRunReport(
  corpus: BulkMigrationCorpus,
  options: BulkMigrationBuildOptions = {},
): BulkDryRunReport {
  const audit = buildBulkMigrationAuditReport(corpus, options);
  const recordsByStoryId = new Map(corpus.stories.map(record => [record.story.id, record]));

  const stories: BulkDryRunStoryReport[] = audit.stories.map(auditStoryReport => {
    if (auditStoryReport.status === 'skipped' || auditStoryReport.status === 'duplicate') {
      return {
        ...auditStoryReport,
        status: auditStoryReport.status,
        valid: null,
        nodeCount: null,
        validationErrors: auditStoryReport.skipReasons,
      };
    }

    const record = recordsByStoryId.get(auditStoryReport.storyId);
    if (!record) {
      return {
        ...auditStoryReport,
        status: 'invalid',
        valid: false,
        nodeCount: null,
        validationErrors: ['story_record_missing'],
        error: 'Story record missing from dry-run corpus.',
      };
    }

    try {
      const result = convertStoryTreeToVNGraph({
        story: record.story,
        segments: record.segments,
        branches: record.branches,
      });
      const validation = validateVNGraph(result.graph, { requireEndingTerminal: true });
      const validationErrors = validation.valid
        ? []
        : validation.errors.length > 0
          ? validation.errors
          : [validation.error];

      return {
        ...auditStoryReport,
        status: validation.valid ? 'valid' : 'invalid',
        valid: validation.valid,
        nodeCount: result.graph.Nodes.length,
        validationErrors,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...auditStoryReport,
        status: 'invalid',
        valid: false,
        nodeCount: null,
        validationErrors: [message],
        error: message,
      };
    }
  });

  return {
    mode: 'dry-run',
    generatedAt: audit.generatedAt,
    converterVersion: audit.converterVersion,
    summary: buildSummary(corpus, stories),
    stories,
  };
}

function auditStory(
  record: BulkStoryCorpusRecord,
  indexes: CorpusIndexes,
  riskLimits: BulkMigrationRiskLimits,
): BulkAuditStoryReport {
  const anomalies = countStoryAnomalies(record, indexes);
  const estimatedNodeCount = estimateConvertedNodeCount(record.segments.length, record.branches.length);
  const existingMigrationChapterCount = record.generatedVNChapters.filter(isMigrationChapter).length;
  const skipReasons: string[] = [];
  const warnings: string[] = [];

  if (record.segments.length === 0) skipReasons.push('zero_segments');
  if (existingMigrationChapterCount > 0) skipReasons.push('existing_migration_chapter');

  addCountWarning(warnings, anomalies.orphanBranches, 'orphan_branches');
  addCountWarning(warnings, anomalies.crossStoryBranches, 'cross_story_branches');
  addCountWarning(warnings, anomalies.branchSourcesOutsideMainline, 'branch_sources_outside_mainline');
  addCountWarning(warnings, anomalies.orphanBranchSegments, 'orphan_branch_segments');
  addCountWarning(warnings, anomalies.crossStoryBranchSegments, 'cross_story_branch_segments');
  addCountWarning(warnings, anomalies.missingParentSegments, 'missing_parent_segments');
  addCountWarning(warnings, anomalies.crossStoryParentSegments, 'cross_story_parent_segments');
  if (record.generatedVNChapters.length > existingMigrationChapterCount) {
    addCountWarning(
      warnings,
      record.generatedVNChapters.length - existingMigrationChapterCount,
      'existing_non_migration_vn_chapters',
    );
  }
  if (record.segments.length > riskLimits.lowSegmentLimit) {
    warnings.push(`large_segment_count:${record.segments.length}`);
  }
  if (record.branches.length > riskLimits.lowBranchLimit) {
    warnings.push(`large_branch_count:${record.branches.length}`);
  }
  if (estimatedNodeCount > riskLimits.highNodeLimit) {
    warnings.push(`large_estimated_node_count:${estimatedNodeCount}`);
  }

  let status: BulkAuditStoryReport['status'] = 'eligible';
  if (record.segments.length === 0) {
    status = 'skipped';
  } else if (existingMigrationChapterCount > 0) {
    status = 'duplicate';
  }

  return {
    storyId: record.story.id,
    title: record.story.title,
    segmentCount: record.segments.length,
    branchCount: record.branches.length,
    estimatedNodeCount,
    existingGeneratedVNChapterCount: record.generatedVNChapters.length,
    existingMigrationChapterCount,
    status,
    risk: assessRisk(record, anomalies, estimatedNodeCount, riskLimits),
    skipReasons,
    warnings,
    anomalies,
  };
}

function countStoryAnomalies(record: BulkStoryCorpusRecord, indexes: CorpusIndexes): BulkStoryAnomalyCounts {
  const anomalies: BulkStoryAnomalyCounts = {
    orphanBranches: 0,
    crossStoryBranches: 0,
    branchSourcesOutsideMainline: 0,
    orphanBranchSegments: 0,
    crossStoryBranchSegments: 0,
    missingParentSegments: 0,
    crossStoryParentSegments: 0,
  };

  for (const branch of record.branches) {
    const source = indexes.segmentsById.get(branch.sourceSegmentId);
    if (!source) {
      anomalies.orphanBranches += 1;
    } else if (source.storyId !== record.story.id) {
      anomalies.crossStoryBranches += 1;
    } else if (source.branchId !== 'main') {
      anomalies.branchSourcesOutsideMainline += 1;
    }
  }

  for (const segment of record.segments) {
    if (segment.branchId !== 'main') {
      const branch = indexes.branchesById.get(segment.branchId);
      if (!branch) {
        anomalies.orphanBranchSegments += 1;
      } else if (branch.storyId !== record.story.id) {
        anomalies.crossStoryBranchSegments += 1;
      }
    }

    if (segment.parentSegmentId) {
      const parent = indexes.segmentsById.get(segment.parentSegmentId);
      if (!parent) {
        anomalies.missingParentSegments += 1;
      } else if (parent.storyId !== record.story.id) {
        anomalies.crossStoryParentSegments += 1;
      }
    }
  }

  return anomalies;
}

function assessRisk(
  record: BulkStoryCorpusRecord,
  anomalies: BulkStoryAnomalyCounts,
  estimatedNodeCount: number,
  riskLimits: BulkMigrationRiskLimits,
): BulkStoryRisk {
  if (
    estimatedNodeCount > riskLimits.highNodeLimit ||
    anomalies.orphanBranches > 0 ||
    anomalies.crossStoryBranches > 0 ||
    anomalies.branchSourcesOutsideMainline > 0 ||
    anomalies.missingParentSegments > 0 ||
    anomalies.crossStoryParentSegments > 0
  ) {
    return 'high';
  }

  if (
    record.segments.length > riskLimits.lowSegmentLimit ||
    record.branches.length > riskLimits.lowBranchLimit ||
    anomalies.orphanBranchSegments > 0 ||
    anomalies.crossStoryBranchSegments > 0
  ) {
    return 'medium';
  }

  return 'low';
}

function buildSummary(
  corpus: BulkMigrationCorpus,
  stories: Array<BulkAuditStoryReport | BulkDryRunStoryReport>,
): BulkMigrationSummary {
  const anomalies = stories.reduce<BulkMigrationAnomalyCounts>((accumulator, story) => {
    accumulator.orphanBranches += story.anomalies.orphanBranches;
    accumulator.crossStoryBranches += story.anomalies.crossStoryBranches;
    accumulator.branchSourcesOutsideMainline += story.anomalies.branchSourcesOutsideMainline;
    accumulator.orphanBranchSegments += story.anomalies.orphanBranchSegments;
    accumulator.crossStoryBranchSegments += story.anomalies.crossStoryBranchSegments;
    accumulator.missingParentSegments += story.anomalies.missingParentSegments;
    accumulator.crossStoryParentSegments += story.anomalies.crossStoryParentSegments;
    accumulator.existingMigrationChapters += story.existingMigrationChapterCount;
    if (story.segmentCount === 0) accumulator.zeroSegmentStories += 1;
    return accumulator;
  }, emptyAnomalyCounts());

  const riskCounts = stories.reduce<BulkMigrationRiskCounts>((accumulator, story) => {
    accumulator[story.risk] += 1;
    return accumulator;
  }, { low: 0, medium: 0, high: 0 });

  return {
    storyCount: corpus.stories.length,
    segmentCount: corpus.stories.reduce((sum, story) => sum + story.segments.length, 0),
    branchCount: corpus.stories.reduce((sum, story) => sum + story.branches.length, 0),
    generatedVNChapterCount: corpus.generatedVNChapterCount,
    generatedAssetCount: corpus.generatedAssetCount,
    eligibleCount: stories.filter(story => story.status === 'eligible' || story.status === 'valid' || story.status === 'invalid').length,
    skippedCount: stories.filter(story => story.status === 'skipped').length,
    duplicateCount: stories.filter(story => story.status === 'duplicate').length,
    validCount: stories.filter(story => story.status === 'valid').length,
    invalidCount: stories.filter(story => story.status === 'invalid').length,
    riskCounts,
    anomalies,
  };
}

function estimateConvertedNodeCount(segmentCount: number, branchCount: number): number {
  return segmentCount + branchCount + 2;
}

function buildCorpusIndexes(corpus: BulkMigrationCorpus): CorpusIndexes {
  const segmentsById = new Map<string, StorySegment>();
  const branchesById = new Map<string, StoryBranch>();

  for (const record of corpus.stories) {
    for (const segment of record.segments) segmentsById.set(segment.id, segment);
    for (const branch of record.branches) branchesById.set(branch.id, branch);
  }

  return { segmentsById, branchesById };
}

function isMigrationChapter(chapter: GeneratedVNChapterSummary): boolean {
  return chapter.branchId.startsWith('migration');
}

function addCountWarning(warnings: string[], count: number, key: string) {
  if (count > 0) warnings.push(`${key}:${count}`);
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
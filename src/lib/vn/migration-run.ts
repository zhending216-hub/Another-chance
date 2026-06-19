import { createHash } from 'crypto';
import prisma from '@/lib/prisma';
import type { Story, StoryBranch, StorySegment } from '@/lib/prisma';
import { BULK_MIGRATION_CONVERTER_VERSION } from './migration-report';

export const STORY_TREE_MIGRATION_KIND = 'story-tree-v1';

export interface StorySourceHashInput {
  story: Story;
  segments: StorySegment[];
  branches: StoryBranch[];
}

export interface VNMigrationRunCounts {
  storyCount?: number;
  segmentCount?: number;
  branchCount?: number;
  validCount?: number;
  invalidCount?: number;
  skippedCount?: number;
}

export interface StartVNMigrationRunOptions extends VNMigrationRunCounts {
  mode: string;
  dryRun: boolean;
  reportPath?: string | null;
}

export interface CompleteVNMigrationRunOptions extends VNMigrationRunCounts {
  reportPath?: string | null;
}

export interface FailVNMigrationRunOptions extends VNMigrationRunCounts {
  reportPath?: string | null;
  errorSummary: string;
}

export function computeStorySourceHash(
  input: StorySourceHashInput,
  converterVersion = BULK_MIGRATION_CONVERTER_VERSION,
): string {
  const payload = {
    converterVersion,
    story: {
      id: input.story.id,
      updatedAt: toIso(input.story.updatedAt),
    },
    segments: [...input.segments]
      .sort(compareSegmentSourceOrder)
      .map(segment => ({
        id: segment.id,
        branchId: segment.branchId,
        parentSegmentId: segment.parentSegmentId,
        content: segment.content,
        updatedAt: toIso(segment.updatedAt),
      })),
    branches: [...input.branches]
      .sort(compareBranchSourceOrder)
      .map(branch => ({
        id: branch.id,
        sourceSegmentId: branch.sourceSegmentId,
        title: branch.title,
        userDirection: branch.userDirection,
        updatedAt: toIso(branch.updatedAt),
      })),
  };

  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function buildVNMigrationRunCreateData(options: StartVNMigrationRunOptions) {
  return {
    mode: options.mode,
    status: 'running',
    dryRun: options.dryRun,
    storyCount: options.storyCount ?? 0,
    segmentCount: options.segmentCount ?? 0,
    branchCount: options.branchCount ?? 0,
    validCount: options.validCount ?? 0,
    invalidCount: options.invalidCount ?? 0,
    skippedCount: options.skippedCount ?? 0,
    reportPath: options.reportPath ?? null,
    errorSummary: null,
  };
}

export function buildVNMigrationRunProgressData(counts: VNMigrationRunCounts, reportPath?: string | null) {
  return {
    ...definedCounts(counts),
    ...(reportPath !== undefined ? { reportPath } : {}),
  };
}

export async function startVNMigrationRun(options: StartVNMigrationRunOptions) {
  return prisma.vNMigrationRun.create({
    data: buildVNMigrationRunCreateData(options),
  });
}

export async function updateVNMigrationRunProgress(
  runId: string,
  counts: VNMigrationRunCounts,
  reportPath?: string | null,
) {
  return prisma.vNMigrationRun.update({
    where: { id: runId },
    data: buildVNMigrationRunProgressData(counts, reportPath),
  });
}

export async function completeVNMigrationRun(runId: string, options: CompleteVNMigrationRunOptions = {}) {
  return prisma.vNMigrationRun.update({
    where: { id: runId },
    data: {
      ...definedCounts(options),
      ...(options.reportPath !== undefined ? { reportPath: options.reportPath } : {}),
      status: 'completed',
      completedAt: new Date(),
      errorSummary: null,
    },
  });
}

export async function failVNMigrationRun(runId: string, options: FailVNMigrationRunOptions) {
  return prisma.vNMigrationRun.update({
    where: { id: runId },
    data: {
      ...definedCounts(options),
      ...(options.reportPath !== undefined ? { reportPath: options.reportPath } : {}),
      status: 'failed',
      completedAt: new Date(),
      errorSummary: options.errorSummary,
    },
  });
}

export async function findVNMigrationRollbackTargets(runId: string) {
  const chapters = await prisma.generatedVNChapter.findMany({
    where: { migrationRunId: runId },
    select: {
      id: true,
      storyId: true,
      branchId: true,
      migrationKind: true,
      sourceHash: true,
    },
    orderBy: { createdAt: 'asc' },
  });
  const chapterIds = chapters.map(chapter => chapter.id);
  const assets = chapterIds.length === 0
    ? []
    : await prisma.generatedAsset.findMany({
        where: { chapterId: { in: chapterIds } },
        select: { id: true, storyId: true, chapterId: true, scopedAssetId: true },
        orderBy: { createdAt: 'asc' },
      });

  return { chapters, assets };
}

export async function rollbackVNMigrationRun(runId: string) {
  return prisma.$transaction(async tx => {
    const chapters = await tx.generatedVNChapter.findMany({
      where: { migrationRunId: runId },
      select: { id: true },
    });
    const chapterIds = chapters.map(chapter => chapter.id);

    const deletedAssets = chapterIds.length === 0
      ? { count: 0 }
      : await tx.generatedAsset.deleteMany({ where: { chapterId: { in: chapterIds } } });
    const deletedChapters = await tx.generatedVNChapter.deleteMany({ where: { migrationRunId: runId } });

    const run = await tx.vNMigrationRun.update({
      where: { id: runId },
      data: {
        status: 'rolled_back',
        completedAt: new Date(),
        errorSummary: null,
      },
    });

    return {
      run,
      deletedChapterCount: deletedChapters.count,
      deletedAssetCount: deletedAssets.count,
    };
  });
}

function definedCounts(counts: VNMigrationRunCounts) {
  return Object.fromEntries(
    Object.entries(counts).filter(([, value]) => typeof value === 'number'),
  );
}

function compareSegmentSourceOrder(left: StorySegment, right: StorySegment): number {
  return compareDate(left.createdAt, right.createdAt) || left.id.localeCompare(right.id);
}

function compareBranchSourceOrder(left: StoryBranch, right: StoryBranch): number {
  return compareDate(left.createdAt, right.createdAt) || left.id.localeCompare(right.id);
}

function compareDate(left: Date, right: Date): number {
  return left.getTime() - right.getTime();
}

function toIso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

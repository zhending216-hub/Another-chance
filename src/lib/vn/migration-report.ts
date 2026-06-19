import path from 'path';
import { mkdir, writeFile } from 'fs/promises';

export const BULK_MIGRATION_CONVERTER_VERSION = 'story-tree-v1';

export type BulkMigrationMode = 'audit' | 'dry-run';
export type BulkStoryRisk = 'low' | 'medium' | 'high';
export type BulkAuditStoryStatus = 'eligible' | 'skipped' | 'duplicate';
export type BulkDryRunStoryStatus = 'valid' | 'invalid' | 'skipped' | 'duplicate';

export interface BulkMigrationAnomalyCounts {
  zeroSegmentStories: number;
  orphanBranches: number;
  crossStoryBranches: number;
  branchSourcesOutsideMainline: number;
  orphanBranchSegments: number;
  crossStoryBranchSegments: number;
  missingParentSegments: number;
  crossStoryParentSegments: number;
  existingMigrationChapters: number;
}

export interface BulkMigrationRiskCounts {
  low: number;
  medium: number;
  high: number;
}

export interface BulkMigrationSummary {
  storyCount: number;
  segmentCount: number;
  branchCount: number;
  generatedVNChapterCount: number;
  generatedAssetCount: number;
  eligibleCount: number;
  skippedCount: number;
  duplicateCount: number;
  validCount: number;
  invalidCount: number;
  riskCounts: BulkMigrationRiskCounts;
  anomalies: BulkMigrationAnomalyCounts;
}

export interface BulkStoryAnomalyCounts {
  orphanBranches: number;
  crossStoryBranches: number;
  branchSourcesOutsideMainline: number;
  orphanBranchSegments: number;
  crossStoryBranchSegments: number;
  missingParentSegments: number;
  crossStoryParentSegments: number;
}

export interface BulkStoryBaseReport {
  storyId: string;
  title: string;
  segmentCount: number;
  branchCount: number;
  estimatedNodeCount: number;
  existingGeneratedVNChapterCount: number;
  existingMigrationChapterCount: number;
  risk: BulkStoryRisk;
  skipReasons: string[];
  warnings: string[];
  anomalies: BulkStoryAnomalyCounts;
}

export interface BulkAuditStoryReport extends BulkStoryBaseReport {
  status: BulkAuditStoryStatus;
}

export interface BulkDryRunStoryReport extends BulkStoryBaseReport {
  status: BulkDryRunStoryStatus;
  valid: boolean | null;
  nodeCount: number | null;
  validationErrors: string[];
  error?: string;
}

export interface BulkMigrationReportBase<TMode extends BulkMigrationMode, TStory> {
  mode: TMode;
  generatedAt: string;
  converterVersion: string;
  summary: BulkMigrationSummary;
  stories: TStory[];
}

export type BulkAuditReport = BulkMigrationReportBase<'audit', BulkAuditStoryReport>;
export type BulkDryRunReport = BulkMigrationReportBase<'dry-run', BulkDryRunStoryReport>;
export type BulkMigrationReport = BulkAuditReport | BulkDryRunReport;

export async function writeMigrationReport(reportPath: string, report: BulkMigrationReport): Promise<string> {
  const targetPath = resolveMigrationReportPath(reportPath);
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(targetPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return targetPath;
}

export function resolveMigrationReportPath(reportPath: string, cwd = process.cwd()): string {
  const trimmed = reportPath.trim();
  if (!trimmed) {
    throw new Error('Report path is required.');
  }

  const exportsRoot = path.resolve(cwd, 'exports');
  const targetPath = path.resolve(cwd, trimmed);
  const relativeToExports = path.relative(exportsRoot, targetPath);

  if (relativeToExports === '' || relativeToExports.startsWith('..') || path.isAbsolute(relativeToExports)) {
    throw new Error(`Report path must be under exports/: ${reportPath}`);
  }

  return targetPath;
}

export function emptyAnomalyCounts(): BulkMigrationAnomalyCounts {
  return {
    zeroSegmentStories: 0,
    orphanBranches: 0,
    crossStoryBranches: 0,
    branchSourcesOutsideMainline: 0,
    orphanBranchSegments: 0,
    crossStoryBranchSegments: 0,
    missingParentSegments: 0,
    crossStoryParentSegments: 0,
    existingMigrationChapters: 0,
  };
}

import prisma from '@/lib/prisma';
import type { VNGraphPreviewResult } from './generation-service';
import type { VNGraphSaveData, VNGraphValidationOptions, VNGraphValidationResult } from './types';
import { validateVNGraph } from './validator';

export interface SaveVNChapterOptions {
  storyId: string;
  branchId: string;
  sourceSegmentId?: string | null;
  createdById?: string | null;
  result: VNGraphPreviewResult;
  migrationRunId?: string | null;
  migrationKind?: string | null;
  sourceHash?: string | null;
}

export function buildVNChapterCreateData(options: SaveVNChapterOptions) {
  return {
    storyId: options.storyId,
    branchId: options.branchId,
    sourceSegmentId: options.sourceSegmentId ?? null,
    graphJson: options.result.graph ? (options.result.graph as any) : undefined,
    rawAIText: options.result.rawAIText,
    status: options.result.success ? 'valid' : 'invalid',
    validationError: options.result.success ? null : options.result.validation.error,
    repairAttempts: options.result.repairAttempts,
    createdById: options.createdById ?? null,
    migrationRunId: options.migrationRunId ?? null,
    migrationKind: options.migrationKind ?? null,
    sourceHash: options.sourceHash ?? null,
  };
}

export async function saveVNChapter(options: SaveVNChapterOptions) {
  return prisma.generatedVNChapter.create({
    data: buildVNChapterCreateData(options),
  });
}

export function revalidateStoredVNChapter(
  graphJson: unknown,
  options: VNGraphValidationOptions = {},
): VNGraphValidationResult {
  if (!graphJson) {
    return { valid: false, error: 'Stored VN chapter has no graphJson.', errors: ['Stored VN chapter has no graphJson.'] };
  }
  return validateVNGraph(graphJson as VNGraphSaveData, options);
}

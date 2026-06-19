import { createHash } from 'crypto';

export type AIVNImageQualityCategory = 'Background' | 'Tachi' | 'Illustration';
export type AIVNImageQualityStatus = 'accepted' | 'rejected' | 'downgraded' | 'skipped';

export interface AIVNImageRetryAttempt {
  attempt: number;
  reason: string;
  promptVersion: string;
}

export interface AIVNImageQualityContractInput {
  category: AIVNImageQualityCategory;
  storyId?: string | null;
  chapterId: string;
  sourceNodeIndex?: number | null;
  storyTitle?: string | null;
  segmentContent?: string | null;
  prompt: string;
  promptVersion?: string;
  provider?: string | null;
  model?: string | null;
  validationStatus: AIVNImageQualityStatus;
  validationError?: string | null;
  retryHistory?: AIVNImageRetryAttempt[];
  qualityWarnings?: string[];
  fallbackReason?: string | null;
}

export interface AIVNImageQualityContract {
  version: 1;
  category: AIVNImageQualityCategory;
  promptVersion: string;
  provider: string;
  model: string;
  source: {
    storyId: string | null;
    chapterId: string;
    sourceNodeIndex: number | null;
    sourceHash: string;
  };
  validation: {
    status: AIVNImageQualityStatus;
    error: string;
    warnings: string[];
  };
  retryHistory: AIVNImageRetryAttempt[];
  fallbackReason: string;
  metrics: {
    retryCount: number;
    accepted: boolean;
    downgraded: boolean;
  };
}

export function buildAIVNImageQualityContract(
  input: AIVNImageQualityContractInput,
): AIVNImageQualityContract {
  const retryHistory = input.retryHistory ?? [];
  const validationError = input.validationError ?? '';
  const warnings = [...(input.qualityWarnings ?? [])];
  if (validationError && input.validationStatus !== 'accepted') warnings.push(validationError);

  return {
    version: 1,
    category: input.category,
    promptVersion: input.promptVersion ?? 'aivn-image-quality-v1',
    provider: input.provider ?? 'configured-provider',
    model: input.model ?? 'configured-model',
    source: {
      storyId: input.storyId ?? null,
      chapterId: input.chapterId,
      sourceNodeIndex: input.sourceNodeIndex ?? null,
      sourceHash: sourceHash({
        category: input.category,
        storyTitle: input.storyTitle ?? '',
        chapterId: input.chapterId,
        segmentContent: input.segmentContent ?? '',
        prompt: input.prompt,
      }),
    },
    validation: {
      status: input.validationStatus,
      error: validationError,
      warnings,
    },
    retryHistory,
    fallbackReason: input.fallbackReason ?? '',
    metrics: {
      retryCount: retryHistory.length,
      accepted: input.validationStatus === 'accepted',
      downgraded: input.validationStatus === 'downgraded',
    },
  };
}

export function classifyAIVNImageFailure(error: string): string {
  const value = (error ?? '').toLowerCase();
  if (!value) return 'unknown';
  if (value.includes('empty')) return 'empty_bytes';
  if (value.includes('html')) return 'provider_returned_html';
  if (value.includes('unsupported')) return 'unsupported_mime';
  if (value.includes('missing')) return 'missing_local_file';
  if (value.includes('identity')) return 'identity_mismatch';
  if (value.includes('vlm')) return 'vlm_rejected';
  return 'validation_failed';
}

export function sourceHash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

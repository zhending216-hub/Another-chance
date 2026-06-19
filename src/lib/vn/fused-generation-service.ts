import type { Story } from '@/lib/prisma';
import type { GenerationContext } from '@/lib/generation/contracts';
import type { VNGenerationContext } from './context-builder';
import {
  generateVNGraphPreview,
  type VNGraphPreviewResult,
  type VNTextAIFn,
} from './generation-service';

export interface GenerateFusedAIVNGraphPreviewOptions {
  context: VNGenerationContext;
  aivnContext: GenerationContext;
  callAIText: VNTextAIFn;
  storyForAI?: Story;
  maxRepairAttempts?: number;
  requireEndingTerminal?: boolean;
  includeDebug?: boolean;
}

export interface FusedAIVNGenerationContextSummary {
  storyId: string;
  branchId: string;
  sourceSegmentId: string | null;
  segmentCount: number;
  characterCount: number;
  exactSpeakerCount: number;
  eventCount: number;
  summaryCount: number;
  hasForkContext: boolean;
  visualStateAssetCount: number;
  whitelistedAssetCount: number;
}

export interface FusedAIVNGraphPreview {
  result: VNGraphPreviewResult;
  contextSummary: FusedAIVNGenerationContextSummary;
}

export async function generateFusedAIVNGraphPreview(
  options: GenerateFusedAIVNGraphPreviewOptions,
): Promise<FusedAIVNGraphPreview> {
  const result = await generateVNGraphPreview({
    context: options.context,
    aivnContext: options.aivnContext,
    callAIText: options.callAIText,
    storyForAI: options.storyForAI,
    maxRepairAttempts: options.maxRepairAttempts,
    requireEndingTerminal: options.requireEndingTerminal,
    includeDebug: options.includeDebug,
  });

  return {
    result,
    contextSummary: buildFusedAIVNGenerationContextSummary(options.context, options.aivnContext),
  };
}

export function buildFusedAIVNGenerationContextSummary(
  context: VNGenerationContext,
  aivnContext: GenerationContext,
): FusedAIVNGenerationContextSummary {
  return {
    storyId: context.story.id,
    branchId: context.branchId,
    sourceSegmentId: context.sourceSegmentId,
    segmentCount: context.chain.length,
    characterCount: context.characters.length,
    exactSpeakerCount: aivnContext.characters?.exactSpeakerIds.length ?? 0,
    eventCount: context.events.length,
    summaryCount: context.summaries.length,
    hasForkContext: Boolean(aivnContext.fork),
    visualStateAssetCount: countVisualStateAssets(aivnContext),
    whitelistedAssetCount: Object.values(aivnContext.assetWhitelist?.assetsByGroup ?? {})
      .reduce((count, assets) => count + (assets?.length ?? 0), 0),
  };
}

function countVisualStateAssets(context: GenerationContext): number {
  const visualState = context.visualState;
  if (!visualState) return 0;
  return [
    visualState.backgroundAssetId,
    visualState.illustrationAssetId,
    ...(visualState.tachiAssetIds ?? []),
  ].filter(Boolean).length;
}

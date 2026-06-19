import type { Story } from '@/lib/prisma';
import type { GenerationAssetGroup, GenerationContext } from '@/lib/generation/contracts';
import type { VNGenerationContext } from './context-builder';
import type { VNAssetResolver, VNAssetWhitelist, VNGraphSaveData, VNGraphValidationOptions, VNGraphValidationResult } from './types';
import { parseAndValidateVNGraphJson } from './validator';
import { buildAIVNGraphPrompt, buildVNGraphPrompt, buildVNSystemPrompt } from './prompt-builder';
import { buildVNGraphRepairPrompt } from './repair';

export interface VNTextAIOptions {
  systemPrompt?: string;
  maxTokens?: number;
  story?: Story;
  priority?: 'high' | 'medium' | 'low';
}

export type VNTextAIFn = (prompt: string, options?: VNTextAIOptions) => Promise<string>;

export interface GenerateVNGraphPreviewOptions {
  context: VNGenerationContext;
  aivnContext?: GenerationContext;
  callAIText: VNTextAIFn;
  storyForAI?: Story;
  maxRepairAttempts?: number;
  requireEndingTerminal?: boolean;
  includeDebug?: boolean;
}

export interface VNGraphPreviewResult {
  success: boolean;
  graph: VNGraphSaveData | null;
  rawAIText: string;
  validation: VNGraphValidationResult;
  repairAttempts: number;
  prompt?: string;
  repairPrompts?: string[];
}

export async function generateVNGraphPreview(
  options: GenerateVNGraphPreviewOptions,
): Promise<VNGraphPreviewResult> {
  const maxRepairAttempts = Math.max(0, Math.min(options.maxRepairAttempts ?? 1, 2));
  const requireEndingTerminal = options.requireEndingTerminal ?? true;
  const prompt = options.aivnContext
    ? buildAIVNGraphPrompt(options.aivnContext, { requireEndingTerminal })
    : buildVNGraphPrompt(options.context, { requireEndingTerminal });
  const validationOptions = buildValidationOptions(options.context, options.aivnContext, requireEndingTerminal);
  const knownSpeakerIds = validationOptions.knownSpeakers ?? [];
  const allowedAssetRefs = collectAllowedAssetRefs(options.aivnContext);
  const repairPrompts: string[] = [];

  let rawAIText = await options.callAIText(prompt, {
    systemPrompt: buildVNSystemPrompt(),
    maxTokens: 6000,
    story: options.storyForAI,
    priority: 'high',
  });

  let parsed = parseAndValidateVNGraphJson(rawAIText, validationOptions);

  let repairAttempts = 0;
  while (!parsed.valid && repairAttempts < maxRepairAttempts) {
    const repairPrompt = buildVNGraphRepairPrompt({
      originalPrompt: prompt,
      rawOutput: rawAIText,
      validationError: parsed.error,
      knownSpeakerIds,
      allowedAssetRefs,
      requireEndingTerminal,
    });
    repairPrompts.push(repairPrompt);
    repairAttempts++;
    rawAIText = await options.callAIText(repairPrompt, {
      systemPrompt: buildVNSystemPrompt(),
      maxTokens: 6000,
      story: options.storyForAI,
      priority: 'high',
    });
    parsed = parseAndValidateVNGraphJson(rawAIText, validationOptions);
  }

  return {
    success: parsed.valid,
    graph: parsed.graph,
    rawAIText,
    validation: {
      valid: parsed.valid,
      error: parsed.error,
      errors: parsed.errors,
    },
    repairAttempts,
    ...(options.includeDebug ? { prompt, repairPrompts } : {}),
  };
}

function buildValidationOptions(
  context: VNGenerationContext,
  aivnContext: GenerationContext | undefined,
  requireEndingTerminal: boolean,
): VNGraphValidationOptions {
  const options: VNGraphValidationOptions = {
    knownSpeakers: aivnContext?.characters?.exactSpeakerIds ?? context.knownSpeakers,
    requireEndingTerminal,
  };

  if (aivnContext?.assetWhitelist) {
    options.assetWhitelist = generationAssetWhitelist(aivnContext);
    options.assetResolver = generationAssetResolver(aivnContext);
  }

  return options;
}

function generationAssetWhitelist(context: GenerationContext): VNAssetWhitelist {
  return {
    contains(category: string, scopedAssetId: string) {
      const group = assetGroupForCategory(category);
      if (!group) return false;
      return (context.assetWhitelist?.assetsByGroup[group] ?? []).includes(scopedAssetId);
    },
  };
}

function generationAssetResolver(context: GenerationContext): VNAssetResolver {
  const allowed = new Set(collectAllowedAssetRefs(context));
  return {
    resolve(scopedAssetId: string) {
      return allowed.has(scopedAssetId) ? 'memory://aivn-generation-asset' : false;
    },
  };
}

function collectAllowedAssetRefs(context: GenerationContext | undefined): string[] {
  if (!context?.assetWhitelist) return [];
  const refs = new Set<string>();
  for (const assets of Object.values(context.assetWhitelist.assetsByGroup)) {
    for (const asset of assets ?? []) refs.add(asset);
  }
  return [...refs].sort();
}

function assetGroupForCategory(category: string): GenerationAssetGroup | null {
  const value = category.trim().toLowerCase();
  if (value === 'background') return 'background';
  if (value === 'tachi') return 'tachi';
  if (value === 'illustration') return 'illustration';
  if (value === 'voice') return 'voice';
  if (value === 'bgm') return 'bgm';
  if (value === 'soundeffect' || value === 'sound_effect') return 'soundeffect';
  return null;
}

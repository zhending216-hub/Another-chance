import type { Story } from '@/lib/prisma';
import type { VNGenerationContext } from './context-builder';
import type { VNGraphSaveData, VNGraphValidationResult } from './types';
import { parseAndValidateVNGraphJson } from './validator';
import { buildVNGraphPrompt, buildVNSystemPrompt } from './prompt-builder';
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
  const prompt = buildVNGraphPrompt(options.context, { requireEndingTerminal });
  const repairPrompts: string[] = [];

  let rawAIText = await options.callAIText(prompt, {
    systemPrompt: buildVNSystemPrompt(),
    maxTokens: 6000,
    story: options.storyForAI,
    priority: 'high',
  });

  let parsed = parseAndValidateVNGraphJson(rawAIText, {
    knownSpeakers: options.context.knownSpeakers,
    requireEndingTerminal,
  });

  let repairAttempts = 0;
  while (!parsed.valid && repairAttempts < maxRepairAttempts) {
    const repairPrompt = buildVNGraphRepairPrompt({
      originalPrompt: prompt,
      rawOutput: rawAIText,
      validationError: parsed.error,
    });
    repairPrompts.push(repairPrompt);
    repairAttempts++;
    rawAIText = await options.callAIText(repairPrompt, {
      systemPrompt: buildVNSystemPrompt(),
      maxTokens: 6000,
      story: options.storyForAI,
      priority: 'high',
    });
    parsed = parseAndValidateVNGraphJson(rawAIText, {
      knownSpeakers: options.context.knownSpeakers,
      requireEndingTerminal,
    });
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

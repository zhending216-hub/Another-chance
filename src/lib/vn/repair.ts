export interface VNRepairPromptOptions {
  originalPrompt: string;
  rawOutput: string;
  validationError: string;
  knownSpeakerIds?: string[];
  allowedAssetRefs?: string[];
  requireEndingTerminal?: boolean;
}

export function buildVNGraphRepairPrompt(options: VNRepairPromptOptions): string {
  const knownSpeakers = options.knownSpeakerIds?.filter(Boolean) ?? [];
  const allowedAssets = options.allowedAssetRefs?.filter(Boolean) ?? [];
  const terminalRule = options.requireEndingTerminal === false
    ? 'A terminal End is optional only if the original instructions allowed a mid-chapter preview.'
    : 'Keep exactly one reachable clean terminal End node.';

  return [
    'Repair the AIVN VNGraph JSON below.',
    'Return ONLY the corrected JSON object. No markdown and no explanation.',
    '',
    'Validation error:',
    options.validationError,
    '',
    'Original instructions:',
    options.originalPrompt.slice(0, 8000),
    '',
    'Invalid output:',
    options.rawOutput.slice(0, 8000),
    '',
    'Repair rules:',
    '- Keep Version=1.',
    '- Do not include InheritedAssets.',
    `- ${terminalRule}`,
    '- Fix serialized Kind/value shapes, required Data fields, output keys, target indexes, and reachability.',
    knownSpeakers.length > 0
      ? `- SpeakerId values must be empty or one of: ${knownSpeakers.join(', ')}.`
      : '- Use empty SpeakerId values unless the original instructions list exact speaker ids.',
    allowedAssets.length > 0
      ? `- Resource fields must be empty or one of these exact asset ids: ${allowedAssets.join(', ')}.`
      : '- Resource fields must stay empty unless the original instructions list exact assets:* ids.',
  ].join('\n');
}

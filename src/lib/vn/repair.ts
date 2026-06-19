export interface VNRepairPromptOptions {
  originalPrompt: string;
  rawOutput: string;
  validationError: string;
}

export function buildVNGraphRepairPrompt(options: VNRepairPromptOptions): string {
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
    '- Keep exactly one Start node and one clean terminal End node unless the instructions explicitly allow otherwise.',
    '- Fix serialized Kind/value shapes, required Data fields, output keys, target indexes, and reachability.',
    '- Use only known speaker ids from the original instructions, or empty speaker ids.',
  ].join('\n');
}

import type { VNGenerationContext } from './context-builder';

export interface VNPromptOptions {
  requireEndingTerminal?: boolean;
}

export function buildVNGraphPrompt(
  context: VNGenerationContext,
  options: VNPromptOptions = {},
): string {
  const recentSegments = context.chain.slice(-8);
  const characters = context.characters.length > 0
    ? context.characters.map(character => {
      const bits = [
        character.name,
        character.canonicalName ? `canonical=${character.canonicalName}` : '',
        character.role ? `role=${character.role}` : '',
        character.speechPatterns ? `speech=${character.speechPatterns}` : '',
        character.appearance ? `appearance=${character.appearance}` : '',
      ].filter(Boolean);
      return `- ${bits.join('; ')}`;
    }).join('\n')
    : '- none registered; use empty speaker ids unless a speaker is explicitly known';

  const branchInstruction = context.branch
    ? `Current branch: ${context.branch.title}\nBranch direction: ${context.branch.userDirection}`
    : 'Current branch: main';

  const terminalRule = options.requireEndingTerminal === false
    ? 'The graph may end with an empty progression output if this is a mid-chapter preview.'
    : 'The graph must end at exactly one clean End node. All progression exits must eventually reach that End node.';

  return [
    'You generate strict AIVN VNGraphSaveData JSON for a playable visual-novel chapter preview.',
    'Return ONLY JSON. No markdown, comments, prose before JSON, or explanation.',
    '',
    'Graph contract:',
    '- Root object: { "Version": 1, "StartNodeIndex": 1, "Nodes": [...] }.',
    '- Do not include InheritedAssets.',
    '- Use positive unique integer Index values.',
    '- NodeType values: Progress=1, Action=2, Condition=3.',
    '- Required node set for first pass: Start node (Progress/SubType 6), Paragraph or Dialogue nodes, optional Choice node, and End node (Progress/SubType 11).',
    '- Start node Data is {}, Outputs is { "Next": [firstProgressIndex] }.',
    '- Paragraph node is Progress/SubType 2 with Data.Lines as a List of Object values. Each line object requires SpeakerId, Text, VoiceId string values. SpeakerId may be empty.',
    '- Dialogue node is Progress/SubType 1 with SpeakerIdData, TextData, VoiceIdData string values.',
    '- Choice node is Progress/SubType 5 with Data.Options as a List of Object values. Each option object requires Text. Outputs must use exact keys "Options[0].Next", "Options[1].Next", etc.',
    '- End node is Progress/SubType 11 with empty string EndingId, Title, and Subtitle. Outputs is {}.',
    '- Every output target must exist and must target a Progress node.',
    '- Use empty string for visual/audio fields unless a valid assets:* id is already provided by context.',
    `- ${terminalRule}`,
    '',
    'Serialized value examples:',
    '- string: { "Kind": "String", "StringValue": "text" }',
    '- list: { "Kind": "List", "Items": [...] }',
    '- object: { "Kind": "Object", "ObjectValue": { ... } }',
    '',
    'Story metadata:',
    `Title: ${context.story.title}`,
    `Description: ${context.story.description || '(empty)'}`,
    `Genre: ${context.story.genre || '(empty)'}`,
    `Era: ${context.story.era || '(empty)'}`,
    branchInstruction,
    '',
    'Known speakers. Use these exact names or an empty speaker id:',
    characters,
    '',
    'Recent story chain:',
    ...recentSegments.map((segment, index) => [
      `Segment ${index + 1} id=${segment.id}`,
      segment.title ? `Title: ${segment.title}` : '',
      segment.content,
    ].filter(Boolean).join('\n')),
    '',
    context.summaries.length > 0 ? `Useful summaries:\n${context.summaries.slice(-5).map(s => `- ${s}`).join('\n')}` : 'Useful summaries: none',
    context.events.length > 0 ? `Active events:\n${context.events.map(e => `- [${e.importance}] ${e.description}`).join('\n')}` : 'Active events: none',
    context.directorState ? `Director state JSON:\n${JSON.stringify(context.directorState).slice(0, 2000)}` : 'Director state: none',
    '',
    'Generation instruction:',
    '- Convert the current continuation moment into 1 short playable VN scene.',
    '- Prefer Paragraph nodes for preserving prose. Use Dialogue only when the speaker is explicit.',
    '- If the next beat naturally branches, add one Choice node with 2-4 options; otherwise keep a linear chain.',
    '- Keep text concise and coherent with the server story state.',
    '- Output valid JSON now.',
  ].join('\n');
}

export function buildVNSystemPrompt(): string {
  return 'You are an AIVN VNGraph compiler. You output strict JSON matching the requested visual-novel graph schema.';
}

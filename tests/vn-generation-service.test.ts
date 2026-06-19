import { describe, expect, it } from 'vitest';
import { generateVNGraphPreview, type VNTextAIFn } from '@/lib/vn/generation-service';
import type { VNGenerationContext } from '@/lib/vn/context-builder';

describe('VNGraph generation service', () => {
  it('returns a valid preview graph from AI JSON', async () => {
    const ai: VNTextAIFn = async () => JSON.stringify(validGraph());

    const result = await generateVNGraphPreview({
      context: contextFixture(),
      callAIText: ai,
      requireEndingTerminal: true,
    });

    expect(result.success, result.validation.error).toBe(true);
    expect(result.graph?.Nodes).toHaveLength(3);
    expect(result.repairAttempts).toBe(0);
  });

  it('repairs invalid AI JSON once', async () => {
    const calls: string[] = [];
    const ai: VNTextAIFn = async prompt => {
      calls.push(prompt);
      return calls.length === 1
        ? JSON.stringify(invalidGraph())
        : JSON.stringify(validGraph());
    };

    const result = await generateVNGraphPreview({
      context: contextFixture(),
      callAIText: ai,
      maxRepairAttempts: 1,
      requireEndingTerminal: true,
      includeDebug: true,
    });

    expect(result.success, result.validation.error).toBe(true);
    expect(result.repairAttempts).toBe(1);
    expect(result.repairPrompts?.[0]).toContain('Validation error');
  });

  it('returns invalid result when repair is disabled', async () => {
    const ai: VNTextAIFn = async () => JSON.stringify(invalidGraph());

    const result = await generateVNGraphPreview({
      context: contextFixture(),
      callAIText: ai,
      maxRepairAttempts: 0,
      requireEndingTerminal: true,
    });

    expect(result.success).toBe(false);
    expect(result.graph).toBeNull();
    expect(result.validation.error).toContain('Text');
  });
});

function contextFixture(): VNGenerationContext {
  return {
    story: {
      id: 'story-1',
      title: 'A Test Story',
      description: 'A short test story.',
      genre: '原创',
      era: '',
    },
    branchId: 'main',
    sourceSegmentId: 'seg-1',
    chain: [{
      id: 'seg-1',
      title: '',
      content: 'Hero reaches the old gate before sunset.',
      parentSegmentId: null,
      imageUrls: [],
      characterIds: ['char-1'],
    }],
    branch: null,
    characters: [{
      id: 'char-1',
      name: 'hero',
      canonicalName: '',
      role: 'protagonist',
      speechPatterns: '',
      appearance: '',
    }],
    directorState: null,
    summaries: [],
    events: [],
    knownSpeakers: ['hero'],
  };
}

function validGraph() {
  return {
    Version: 1,
    StartNodeIndex: 1,
    Nodes: [
      {
        Index: 1,
        DisplayName: '',
        Comment: '',
        NodeType: 1,
        SubType: 6,
        X: 80,
        Y: 120,
        Data: {},
        Outputs: { Next: [2] },
      },
      {
        Index: 2,
        DisplayName: '',
        Comment: '',
        NodeType: 1,
        SubType: 2,
        X: 360,
        Y: 120,
        Data: {
          Lines: {
            Kind: 'List',
            Items: [{
              Kind: 'Object',
              ObjectValue: {
                SpeakerId: { Kind: 'String', StringValue: 'hero' },
                Text: { Kind: 'String', StringValue: 'We made it before sunset.' },
                VoiceId: { Kind: 'String', StringValue: '' },
              },
            }],
          },
        },
        Outputs: { Actions: [], Next: [3] },
      },
      {
        Index: 3,
        DisplayName: '',
        Comment: '',
        NodeType: 1,
        SubType: 11,
        X: 640,
        Y: 120,
        Data: {
          EndingId: { Kind: 'String', StringValue: '' },
          Title: { Kind: 'String', StringValue: '' },
          Subtitle: { Kind: 'String', StringValue: '' },
        },
        Outputs: {},
      },
    ],
  };
}

function invalidGraph() {
  const graph = validGraph();
  const paragraph = graph.Nodes[1] as any;
  delete paragraph.Data.Lines.Items[0].ObjectValue.Text;
  return graph;
}

import { describe, expect, it } from 'vitest';
import { generateVNGraphPreview, type VNTextAIFn } from '@/lib/vn/generation-service';
import type { VNGenerationContext } from '@/lib/vn/context-builder';
import type { GenerationContext } from '@/lib/generation/contracts';

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

  it('uses strict AIVN context for prompts, speaker validation, and whitelisted assets', async () => {
    const prompts: string[] = [];
    const ai: VNTextAIFn = async prompt => {
      prompts.push(prompt);
      return JSON.stringify(validGraphWithBackground());
    };

    const result = await generateVNGraphPreview({
      context: contextFixture(),
      aivnContext: aivnContextFixture(),
      callAIText: ai,
      requireEndingTerminal: true,
      includeDebug: true,
    });

    expect(result.success, result.validation.error).toBe(true);
    expect(prompts[0]).toContain('AIVN strict generation contract');
    expect(prompts[0]).toContain('Asset whitelist:');
    expect(prompts[0]).toContain('assets:bg.old.gate');
    expect(result.prompt).toContain('selected option: Enter the left corridor');
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

function validGraphWithBackground() {
  const graph = validGraph();
  const start = graph.Nodes[0] as any;
  start.Data = {
    BackgroundImage: { Kind: 'String', StringValue: 'assets:bg.old.gate' },
  };
  const paragraph = graph.Nodes[1] as any;
  paragraph.Data.Lines.Items[0].ObjectValue.SpeakerId.StringValue = '林澈';
  return graph;
}

function aivnContextFixture(): GenerationContext {
  return {
    mode: 'vnGraphPreview',
    story: {
      id: 'story-1',
      title: 'Gate of Rain',
      description: 'A short VN test story.',
      genre: '原创',
      era: 'near future',
    },
    branchId: 'branch-1',
    sourceSegmentId: 'seg-2',
    chain: [{
      id: 'seg-1',
      title: '',
      content: '林澈在雨里抵达旧门。',
      parentSegmentId: null,
      imageUrls: [],
      characterIds: ['char-1'],
    }, {
      id: 'seg-2',
      title: '',
      content: 'Mira 指向左侧走廊。',
      parentSegmentId: 'seg-1',
      imageUrls: [],
      characterIds: ['char-1', 'char-2'],
    }],
    branch: {
      id: 'branch-1',
      title: 'Left corridor',
      userDirection: 'Follow the sound behind the wall.',
      sourceSegmentId: 'seg-2',
    },
    fork: {
      selectedOptionText: 'Enter the left corridor',
      sourceGraphPath: 'Books/gushi_demo/Chapters/chapter_001.json',
      currentBackgroundImage: 'assets:bg.old.gate',
      recentDialogue: [{
        speakerId: '林澈',
        text: '雨还没有停。',
      }],
      variables: { route: 'left' },
    },
    characters: {
      exactSpeakerIds: ['林澈', 'Mira'],
      entries: [{
        id: '林澈',
        displayName: '林澈',
        canonicalName: 'Lin Che',
        aliases: ['char-1', 'Lin Che'],
        role: 'protagonist',
        speechPatterns: 'short, restrained lines',
        appearance: 'dark coat, tired eyes',
        voiceCard: 'role=protagonist; speech=short, restrained lines',
      }],
    },
    assetWhitelist: {
      assetsByGroup: {
        background: ['assets:bg.old.gate'],
      },
    },
    visualState: {
      backgroundAssetId: 'assets:bg.old.gate',
    },
  };
}

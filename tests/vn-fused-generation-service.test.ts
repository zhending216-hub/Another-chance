import { describe, expect, it } from 'vitest';
import {
  buildFusedAIVNGenerationContextSummary,
  generateFusedAIVNGraphPreview,
} from '@/lib/vn/fused-generation-service';
import type { GenerationContext } from '@/lib/generation/contracts';
import type { VNGenerationContext } from '@/lib/vn/context-builder';
import type { VNTextAIFn } from '@/lib/vn/generation-service';

describe('fused AIVN generation service', () => {
  it('runs strict AIVN graph generation without replacing legacy VN context', async () => {
    const prompts: string[] = [];
    const ai: VNTextAIFn = async prompt => {
      prompts.push(prompt);
      return JSON.stringify(validGraph());
    };

    const preview = await generateFusedAIVNGraphPreview({
      context: vnContextFixture(),
      aivnContext: aivnContextFixture(),
      callAIText: ai,
      requireEndingTerminal: true,
      includeDebug: true,
    });

    expect(preview.result.success, preview.result.validation.error).toBe(true);
    expect(preview.result.prompt).toContain('AIVN strict generation contract');
    expect(prompts[0]).toContain('Exact speaker ids');
    expect(preview.contextSummary).toMatchObject({
      storyId: 'story-1',
      branchId: 'main',
      segmentCount: 1,
      exactSpeakerCount: 1,
      whitelistedAssetCount: 1,
    });
  });

  it('summarizes fork and visual context for route responses', () => {
    const summary = buildFusedAIVNGenerationContextSummary(vnContextFixture(), aivnContextFixture());

    expect(summary.hasForkContext).toBe(true);
    expect(summary.visualStateAssetCount).toBe(1);
    expect(summary.characterCount).toBe(1);
  });
});

function vnContextFixture(): VNGenerationContext {
  return {
    story: {
      id: 'story-1',
      title: 'Gate of Rain',
      description: '',
      genre: '原创',
      era: '',
    },
    branchId: 'main',
    sourceSegmentId: 'seg-1',
    chain: [{
      id: 'seg-1',
      title: '',
      content: '林澈在雨里抵达旧门。',
      parentSegmentId: null,
      imageUrls: [],
      characterIds: ['char-1'],
    }],
    branch: null,
    characters: [{
      id: 'char-1',
      name: '林澈',
      canonicalName: 'Lin Che',
      role: 'protagonist',
      speechPatterns: 'short, restrained lines',
      appearance: 'dark coat',
    }],
    directorState: null,
    summaries: [],
    events: [],
    knownSpeakers: ['林澈'],
  };
}

function aivnContextFixture(): GenerationContext {
  return {
    mode: 'vnGraphPreview',
    story: {
      id: 'story-1',
      title: 'Gate of Rain',
    },
    branchId: 'main',
    sourceSegmentId: 'seg-1',
    chain: [{
      id: 'seg-1',
      content: '林澈在雨里抵达旧门。',
    }],
    fork: {
      selectedOptionText: 'Open the gate',
      currentBackgroundImage: 'assets:bg.old.gate',
    },
    characters: {
      exactSpeakerIds: ['林澈'],
      entries: [{
        id: '林澈',
        displayName: '林澈',
        canonicalName: 'Lin Che',
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
                SpeakerId: { Kind: 'String', StringValue: '林澈' },
                Text: { Kind: 'String', StringValue: '门后还有声音。' },
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

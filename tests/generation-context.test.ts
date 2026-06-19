import { describe, expect, it } from 'vitest';
import { toAIVNGenerationContext, type VNGenerationContext } from '@/lib/vn/context-builder';
import { whitelistContains } from '@/lib/generation/contracts';

describe('AIVN generation context adapter', () => {
  it('preserves server story context while emitting the unified generation contract', () => {
    const context = toAIVNGenerationContext(vnContextFixture(), {
      mode: 'vnGraphPreview',
    });

    expect(context.mode).toBe('vnGraphPreview');
    expect(context.story.title).toBe('Gate of Rain');
    expect(context.chain.map(segment => segment.id)).toEqual(['seg-1', 'seg-2']);
    expect(context.summaries).toEqual(['The hero reached the old gate.']);
    expect(context.events?.[0]).toMatchObject({
      id: 'event-1',
      description: 'The gate closes at sunset.',
      status: 'active',
    });
    expect(context.directorState).toEqual({
      worldVariables: { weather: 'rain' },
      activeConstraints: ['No new named characters.'],
    });
  });

  it('builds exact speaker tables, aliases, appearance, and voice cards', () => {
    const context = toAIVNGenerationContext(vnContextFixture());

    expect(context.characters?.exactSpeakerIds).toEqual(['林澈', 'Mira']);
    expect(context.characters?.entries[0]).toMatchObject({
      id: '林澈',
      displayName: '林澈',
      canonicalName: 'Lin Che',
      aliases: ['char-1', 'Lin Che'],
      role: 'protagonist',
      speechPatterns: 'short, restrained lines',
      appearance: 'dark coat, tired eyes',
      voiceCard: 'role=protagonist; speech=short, restrained lines',
    });
    expect(context.characters?.aliasesBySpeakerId?.['林澈']).toEqual(['char-1', 'Lin Che']);
  });

  it('adapts branch/fork runtime context and visual state without requiring Godot', () => {
    const context = toAIVNGenerationContext(vnContextFixture(), {
      fork: {
        selectedOptionText: 'Enter the left corridor',
        sourceGraphPath: 'Books/gushi_demo/Chapters/chapter_001.json',
        currentBackgroundImage: 'assets:bg.old.gate',
        currentIllustrationImage: 'assets:cg.gate.reveal',
        recentDialogue: [{
          speakerId: '林澈',
          text: '雨还没有停。',
        }],
        tachis: [{
          tachiId: '林澈',
          image: 'assets:char.lin_che.default',
        }],
        variables: { route: 'left' },
        variableDefinitions: { route: 'Selected corridor route.' },
        attributes: { trust: 2 },
      },
    });

    expect(context.branch).toMatchObject({
      id: 'branch-1',
      title: 'Left corridor',
      userDirection: 'Follow the sound behind the wall.',
      sourceSegmentId: 'seg-2',
    });
    expect(context.fork?.selectedOptionText).toBe('Enter the left corridor');
    expect(context.visualState).toEqual({
      backgroundAssetId: 'assets:bg.old.gate',
      illustrationAssetId: 'assets:cg.gate.reveal',
      tachiAssetIds: ['assets:char.lin_che.default'],
    });
  });

  it('combines persisted/generated assets with current visual state into an AIVN whitelist', () => {
    const context = toAIVNGenerationContext(vnContextFixture(), {
      visualState: {
        backgroundAssetId: 'assets:bg.old.gate',
        illustrationAssetId: 'assets:cg.gate.reveal',
        tachiAssetIds: ['assets:char.lin_che.default'],
      },
      generatedAssets: [{
        category: 'Background',
        assetId: 'bg.generated.room',
        scopedAssetId: 'assets:bg.generated.room',
        sourceHash: 'hash-1',
        publicUrl: '/generated-images/room.png',
      }],
    });

    expect(whitelistContains(context.assetWhitelist, 'Background', 'assets:bg.generated.room')).toBe(true);
    expect(whitelistContains(context.assetWhitelist, 'Background', 'assets:bg.old.gate')).toBe(true);
    expect(whitelistContains(context.assetWhitelist, 'Illustration', 'assets:cg.gate.reveal')).toBe(true);
    expect(whitelistContains(context.assetWhitelist, 'Tachi', 'assets:char.lin_che.default')).toBe(true);
  });
});

function vnContextFixture(): VNGenerationContext {
  return {
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
      imageUrls: ['/generated-images/seg-1-0.png'],
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
    characters: [{
      id: 'char-1',
      name: '林澈',
      canonicalName: 'Lin Che',
      role: 'protagonist',
      speechPatterns: 'short, restrained lines',
      appearance: 'dark coat, tired eyes',
    }, {
      id: 'char-2',
      name: 'Mira',
      canonicalName: '',
      role: 'guide',
      speechPatterns: '',
      appearance: '',
    }],
    directorState: {
      worldVariables: { weather: 'rain' },
      activeConstraints: ['No new named characters.'],
    },
    summaries: ['The hero reached the old gate.'],
    events: [{
      id: 'event-1',
      eventType: 'deadline',
      description: 'The gate closes at sunset.',
      importance: 'high',
      status: 'active',
    }],
    knownSpeakers: ['林澈', 'Mira'],
  };
}

import { describe, expect, it } from 'vitest';
import {
  addAssetToWhitelist,
  createAssetWhitelist,
  createGenerationRunReport,
  getAssetGroup,
  getRequiredAssetIdPrefix,
  isValidGeneratedAssetId,
  normalizeScopedAssetId,
  whitelistContains,
  type GenerationContext,
  type GenerationRunReport,
} from '@/lib/generation/contracts';

describe('generation fusion contracts', () => {
  it('represents the existing server prose continuation context', () => {
    const context: GenerationContext = {
      mode: 'proseContinuation',
      story: {
        id: 'story-1',
        title: 'A Test Story',
        description: 'A short test story.',
        genre: '原创',
      },
      branchId: 'main',
      sourceSegmentId: 'seg-1',
      chain: [{
        id: 'seg-1',
        content: 'Hero reaches the old gate before sunset.',
        parentSegmentId: null,
        imageUrls: ['/generated-images/seg-1-0.png'],
        characterIds: ['char-1'],
      }],
      summaries: ['The hero is searching for the western gate.'],
      events: [{
        id: 'event-1',
        description: 'The gate closes at sunset.',
        importance: 4,
        status: 'active',
      }],
      directorState: { tension: 'rising' },
    };

    expect(context.mode).toBe('proseContinuation');
    expect(context.chain[0].imageUrls).toEqual(['/generated-images/seg-1-0.png']);
    expect(context.events?.[0].description).toContain('gate');
  });

  it('represents local AIVN fork context and exact speaker tables', () => {
    const context: GenerationContext = {
      mode: 'vnGraphPreview',
      story: {
        id: 'story-1',
        title: 'A Test Story',
      },
      branchId: 'branch-a',
      sourceSegmentId: 'seg-2',
      chain: [{
        id: 'seg-2',
        content: 'The player chooses the left corridor.',
      }],
      branch: {
        id: 'branch-a',
        title: 'Left corridor',
        userDirection: 'Follow the sound behind the wall.',
        sourceSegmentId: 'seg-2',
      },
      fork: {
        selectedOptionText: 'Take the left corridor',
        sourceGraphPath: 'Books/demo/Chapters/chapter_001.json',
        currentBackgroundImage: 'assets:bg.old.gate',
        currentIllustrationImage: '',
        recentDialogue: [{
          speakerId: 'hero',
          text: 'We made it before sunset.',
        }],
        tachis: [{
          tachiId: 'hero',
          image: 'assets:char.hero.default',
        }],
        variables: { route: 'left' },
        variableDefinitions: { route: 'Selected route key' },
        attributes: { trust: 2 },
      },
      characters: {
        exactSpeakerIds: ['hero'],
        aliasesBySpeakerId: {
          hero: ['Hero', '主角'],
        },
        entries: [{
          id: 'hero',
          displayName: 'hero',
          aliases: ['Hero', '主角'],
          speechPatterns: 'short, direct lines',
          appearance: 'dark coat, tired eyes',
          voiceCard: 'low, restrained confidence',
        }],
      },
    };

    expect(context.fork?.selectedOptionText).toBe('Take the left corridor');
    expect(context.characters?.exactSpeakerIds).toEqual(['hero']);
    expect(context.characters?.entries[0].voiceCard).toContain('restrained');
  });

  it('normalizes local AIVN asset whitelist groups and generated id prefixes', () => {
    expect(getAssetGroup('Background')).toBe('background');
    expect(getAssetGroup('Tachi')).toBe('tachi');
    expect(getAssetGroup('Illustration')).toBe('illustration');

    expect(getRequiredAssetIdPrefix('Background')).toBe('bg.');
    expect(getRequiredAssetIdPrefix('Tachi')).toBe('char.');
    expect(getRequiredAssetIdPrefix('Illustration')).toBe('cg.');

    expect(normalizeScopedAssetId(' BG.DEMO.Room ')).toBe('assets:bg.demo.room');
    expect(isValidGeneratedAssetId('Background', 'assets:bg.demo.room')).toBe(true);
    expect(isValidGeneratedAssetId('Background', 'assets:char.hero.default')).toBe(false);

    const whitelist = createAssetWhitelist([{
      category: 'Background',
      assetId: 'bg.demo.room',
      scopedAssetId: 'assets:bg.demo.room',
      sourceHash: 'hash-1',
    }]);

    addAssetToWhitelist(whitelist, 'Tachi', 'assets:char.hero.default');
    addAssetToWhitelist(whitelist, 'Illustration', 'cg.hero.reveal');

    expect(whitelistContains(whitelist, 'Background', 'assets:bg.demo.room')).toBe(true);
    expect(whitelistContains(whitelist, 'Tachi', 'assets:char.hero.default')).toBe(true);
    expect(whitelistContains(whitelist, 'Illustration', 'assets:cg.hero.reveal')).toBe(true);
    expect(whitelist.assetsByGroup.background).toEqual(['assets:bg.demo.room']);
  });

  it('separates nonblocking image warnings from generation errors', () => {
    const report: GenerationRunReport = createGenerationRunReport({
      runId: 'run-1',
      mode: 'vnGraphWithAssetsPreview',
      success: true,
      sourceHash: 'source-hash-1',
      validation: {
        valid: true,
        requireEndingTerminal: true,
        issues: [],
      },
      visualIntents: [{
        id: 'beat_0002_00',
        order: 0,
        kind: 'Narration',
        criticality: 'Normal',
        sourceNodeIndex: 2,
        sourceHash: 'beat-hash-1',
        text: 'The empty gate waits under rain.',
        backgroundAssetId: 'assets:bg.old.gate',
      }],
      issues: [{
        severity: 'warning',
        code: 'image_generation_failed',
        message: 'Keeping text-only VNGraph because image generation failed.',
      }],
    });

    expect(report.success).toBe(true);
    expect(report.validation?.valid).toBe(true);
    expect(report.warnings).toHaveLength(1);
    expect(report.errors).toHaveLength(0);
    expect(report.visualIntents?.[0].backgroundAssetId).toBe('assets:bg.old.gate');
  });
});

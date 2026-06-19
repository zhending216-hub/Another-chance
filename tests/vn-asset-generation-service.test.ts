import { describe, expect, it } from 'vitest';
import {
  generateAIVNChapterAssetPreview,
  validateAIVNImageBytes,
} from '@/lib/vn/asset-generation-service';
import type { VNGraphSaveData } from '@/lib/vn/types';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);
const JPG_BYTES = Buffer.from([0xFF, 0xD8, 0xFF, 0x00]);
const WEBP_BYTES = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('AIVN chapter asset generation service', () => {
  it('validates real image bytes and rejects placeholders/html', () => {
    expect(validateAIVNImageBytes(PNG_BYTES)).toMatchObject({ valid: true, mimeType: 'image/png', extension: '.png' });
    expect(validateAIVNImageBytes(JPG_BYTES)).toMatchObject({ valid: true, mimeType: 'image/jpeg', extension: '.jpg' });
    expect(validateAIVNImageBytes(WEBP_BYTES)).toMatchObject({ valid: true, mimeType: 'image/webp', extension: '.webp' });
    expect(validateAIVNImageBytes(Buffer.from('<html>nope</html>')).error).toContain('HTML');
    expect(validateAIVNImageBytes(Buffer.from('<svg></svg>')).valid).toBe(false);
    expect(validateAIVNImageBytes(Buffer.alloc(0)).error).toContain('empty');
  });

  it('previews a background asset, injects it into Start, and revalidates graph', async () => {
    const result = await generateAIVNChapterAssetPreview({
      storyTitle: 'Gate of Rain',
      chapterId: 'chapter_001',
      category: 'Background',
      graph: graphFixture(),
      segmentId: 'seg-1',
      segmentContent: 'Rain falls over the old gate.',
      knownSpeakers: [],
      generateImages: async () => [{
        url: '/generated-images/test.png',
        description: 'old gate in rain',
        type: 'scene',
        prompt: 'cinematic rainy gate',
      }],
      loadImageFile: async () => ({
        localPath: '/tmp/test.png',
        bytes: PNG_BYTES,
      }),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.asset.assetId).toMatch(/^bg\.gate\.of\.rain\.chapter\.001\.0$/);
    expect(result.asset.mimeType).toBe('image/png');
    expect(result.asset.sha256).toHaveLength(64);
    expect(result.asset.quality.validation.status).toBe('accepted');
    expect(result.asset.quality.source.sourceHash).toHaveLength(64);
    expect(result.graphChanged).toBe(true);
    expect(result.validation.valid, result.validation.error).toBe(true);
    expect(result.graph.Nodes[0].Data.BackgroundImage).toEqual({
      Kind: 'String',
      StringValue: result.asset.scopedAssetId,
    });
  });

  it('keeps graph text-only when generated image bytes are invalid', async () => {
    const result = await generateAIVNChapterAssetPreview({
      storyTitle: 'Gate of Rain',
      chapterId: 'chapter_001',
      category: 'Background',
      graph: graphFixture(),
      segmentId: 'seg-1',
      segmentContent: 'Rain falls over the old gate.',
      generateImages: async () => [{
        url: '/generated-images/fallback.svg',
        description: 'placeholder',
        type: 'scene',
        prompt: 'placeholder',
      }],
      loadImageFile: async () => ({
        localPath: '/tmp/fallback.svg',
        bytes: Buffer.from('<svg></svg>'),
      }),
    });

    expect(result.success).toBe(false);
    expect(result.graphChanged).toBe(false);
    expect(result.graph.Nodes[0].Data.BackgroundImage).toBeUndefined();
    expect(result.warning).toContain('text-only');
  });

  it('can generate non-background assets without forcing graph placement', async () => {
    const result = await generateAIVNChapterAssetPreview({
      storyTitle: 'Gate of Rain',
      chapterId: 'chapter_001',
      category: 'Illustration',
      graph: graphFixture(),
      segmentId: 'seg-1',
      segmentContent: 'The reveal happens under rain.',
      generateImages: async () => [{
        url: '/generated-images/cg.png',
        description: 'reveal',
        type: 'scene',
        prompt: 'event cg reveal',
      }],
      loadImageFile: async () => ({
        localPath: '/tmp/cg.png',
        bytes: PNG_BYTES,
      }),
    });

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.asset.assetId).toMatch(/^cg\./);
    expect(result.graphChanged).toBe(false);
    expect(result.warning).toContain('graph placement was not changed');
  });
});

function graphFixture(): VNGraphSaveData {
  return {
    Version: 1,
    StartNodeIndex: 1,
    Nodes: [{
      Index: 1,
      DisplayName: '',
      Comment: '',
      NodeType: 1,
      SubType: 6,
      X: 0,
      Y: 0,
      Data: {},
      Outputs: { Next: [2] },
    }, {
      Index: 2,
      DisplayName: '',
      Comment: '',
      NodeType: 1,
      SubType: 11,
      X: 300,
      Y: 0,
      Data: {
        EndingId: { Kind: 'String', StringValue: '' },
        Title: { Kind: 'String', StringValue: '' },
        Subtitle: { Kind: 'String', StringValue: '' },
      },
      Outputs: {},
    }],
  };
}

import { describe, expect, it } from 'vitest';
import {
  buildAIVNAssetIds,
  collectScopedAssetIds,
  generatedAssetResolver,
  generatedAssetWhitelist,
  injectBackgroundAsset,
} from '@/lib/vn/asset-bridge';
import type { VNGraphSaveData } from '@/lib/vn/types';

describe('VN asset bridge', () => {
  it('builds scoped AIVN asset ids', () => {
    const ids = buildAIVNAssetIds({
      storyTitle: 'Dark Forest Fall!',
      chapterId: 'chapter_1234567890',
      category: 'Background',
    });

    expect(ids.assetId).toContain('bg.dark.forest.fall');
    expect(ids.scopedAssetId).toBe(`assets:${ids.assetId}`);
  });

  it('injects a background asset into the Start node', () => {
    const graph = graphFixture();
    const next = injectBackgroundAsset(graph, 'assets:bg.demo.room');

    expect(graph.Nodes[0].Data.BackgroundImage).toBeUndefined();
    expect(next.Nodes[0].Data.BackgroundImage).toEqual({
      Kind: 'String',
      StringValue: 'assets:bg.demo.room',
    });
  });

  it('collects scoped asset ids recursively', () => {
    const next = injectBackgroundAsset(graphFixture(), 'assets:bg.demo.room');
    expect(collectScopedAssetIds(next)).toEqual(['assets:bg.demo.room']);
  });

  it('builds validator whitelist and resolver hooks', () => {
    const assets = [{
      assetId: 'bg.demo.room',
      scopedAssetId: 'assets:bg.demo.room',
      category: 'Background',
      publicUrl: '/generated-images/demo.png',
      localPath: '/tmp/demo.png',
    }];

    expect(generatedAssetWhitelist(assets).contains('Background', 'assets:bg.demo.room')).toBe(true);
    expect(generatedAssetWhitelist(assets).contains('Tachi', 'assets:bg.demo.room')).toBe(false);
    expect(generatedAssetResolver(assets).resolve('assets:bg.demo.room', 'Texture2D', 'Background')).toBe('/tmp/demo.png');
    expect(generatedAssetResolver(assets).resolve('assets:bg.missing', 'Texture2D', 'Background')).toBe(false);
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
      Outputs: { Next: [] },
    }],
  };
}

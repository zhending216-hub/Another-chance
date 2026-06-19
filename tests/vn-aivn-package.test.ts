import { describe, expect, it } from 'vitest';
import {
  buildAIVNBookManifest,
  buildAIVNPackageId,
  collectVNGraphAssetReferences,
} from '@/lib/vn/aivn-package';
import type { VNGraphSaveData } from '@/lib/vn/types';

describe('AIVN installable package helpers', () => {
  it('builds stable gushi package ids', () => {
    expect(buildAIVNPackageId('story_123')).toBe('gushi_story_123');
    expect(buildAIVNPackageId('story_1_?????')).toBe('gushi_story_1');
  });

  it('builds a book manifest with entry story and source metadata', () => {
    const manifest = buildAIVNBookManifest({
      packageId: 'gushi_story_123',
      title: 'Story Title',
      authorId: 'user-1',
      chapterAssetId: 'story.chapter_001',
      chapterFile: 'chapter_001.json',
      chapterHash: 'abc123',
      usedAssets: [],
      sourceStoryId: 'story-123',
      sourceChapterId: 'chapter-123',
      sourceMigrationRunId: 'run-123',
    });

    expect(manifest.entry_story).toBe('story.chapter_001');
    expect(manifest.assets['story.chapter_001']).toEqual({
      type: 'story',
      category: 'chapter',
      path: 'Chapters/chapter_001.json',
      hash: 'sha256-abc123',
    });
    expect(manifest.author_id).toBe('server:user-1');
    expect(manifest.metadata.source_migration_run_id).toBe('run-123');
  });

  it('collects assets scoped references from graph data', () => {
    const graph: VNGraphSaveData = {
      Version: 1,
      StartNodeIndex: 1,
      Nodes: [{
        Index: 1,
        DisplayName: 'Start',
        Comment: '',
        NodeType: 1,
        SubType: 6,
        X: 0,
        Y: 0,
        Data: {
          BackgroundImage: { Kind: 'String', StringValue: 'assets:bg.demo.room' },
          Nested: {
            Kind: 'Object',
            ObjectValue: {
              Image: { Kind: 'String', StringValue: 'assets:cg.demo.final' },
              Url: { Kind: 'String', StringValue: '/generated-images/raw.png' },
            },
          },
        },
        Outputs: { Next: [] },
      }],
    };

    expect(collectVNGraphAssetReferences(graph)).toEqual([
      'assets:bg.demo.room',
      'assets:cg.demo.final',
    ]);
  });
});

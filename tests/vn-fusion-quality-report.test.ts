import { describe, expect, it } from 'vitest';
import { buildAIVNFusionQualityReport } from '@/lib/vn/fusion-quality-report';

describe('AIVN fusion quality report', () => {
  it('scores graph, visual, asset manifest, and object completeness dimensions', () => {
    const report = buildAIVNFusionQualityReport({
      generatedAt: '2026-06-19T00:00:00.000Z',
      gitCommit: 'abc123',
      stories: [{ id: 'story-1', title: 'Story One' }],
      characters: [{ storyId: 'story-1', name: 'hero' }],
      chapters: [{
        id: 'chapter-1',
        storyId: 'story-1',
        status: 'valid',
        migrationRunId: 'run-1',
        graphJson: graphFixture(),
      }],
      assets: [{
        storyId: 'story-1',
        chapterId: 'chapter-1',
        assetId: 'char.hero',
        scopedAssetId: 'assets:char.hero',
        category: 'Tachi',
        publicUrl: '/generated-images/char.hero.png',
        localPath: __filename,
      }],
    });

    expect(report.corpus).toMatchObject({
      storyCount: 1,
      chapterCount: 1,
      assetCount: 1,
      validGraphCount: 1,
      readyChapterCount: 1,
    });
    expect(report.thresholds.persistedGraphsValidate).toBe(true);
    expect(report.thresholds.referencedAssetsResolve).toBe(true);
    expect(report.thresholds.objectFilesComplete).toBe(true);
    expect(report.stories[0].chapters[0].visuals.tachiActionCount).toBe(1);
  });
});

function graphFixture() {
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
      SubType: 1,
      X: 240,
      Y: 0,
      Data: {
        SpeakerIdData: { Kind: 'String', StringValue: 'hero' },
        TextData: { Kind: 'String', StringValue: 'Hello.' },
        VoiceIdData: { Kind: 'String', StringValue: '' },
      },
      Outputs: { Actions: [4], Next: [3] },
    }, {
      Index: 3,
      DisplayName: '',
      Comment: '',
      NodeType: 1,
      SubType: 11,
      X: 480,
      Y: 0,
      Data: {
        EndingId: { Kind: 'String', StringValue: '' },
        Title: { Kind: 'String', StringValue: '' },
        Subtitle: { Kind: 'String', StringValue: '' },
      },
      Outputs: {},
    }, {
      Index: 4,
      DisplayName: '',
      Comment: '',
      NodeType: 2,
      SubType: 7,
      X: 240,
      Y: 180,
      Data: {},
      Outputs: { Actions: [5] },
    }, {
      Index: 5,
      DisplayName: '',
      Comment: '',
      NodeType: 2,
      SubType: 1,
      X: 80,
      Y: 180,
      Data: {
        TachiID: { Kind: 'String', StringValue: 'hero' },
        TachiIamge: { Kind: 'String', StringValue: 'assets:char.hero' },
        TargetPosition: { Kind: 'Vector2', X: 520, Y: 780 },
        EnterType: { Kind: 'Enum', StringValue: 'FadeIn' },
        Duration: { Kind: 'Float', NumberValue: 0.25 },
      },
      Outputs: {},
    }],
  };
}

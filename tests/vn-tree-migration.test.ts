import { describe, expect, it } from 'vitest';
import { convertStoryTreeToVNGraph } from '@/lib/vn/tree-migration';

describe('story tree to VNGraph migration', () => {
  it('converts a linear story into a valid terminal graph', () => {
    const result = convertStoryTreeToVNGraph({
      story: storyFixture(),
      segments: [
        segment('seg-1', 'main', null, 'The first paragraph.'),
        segment('seg-2', 'main', 'seg-1', 'The second paragraph.'),
      ],
      branches: [],
    });

    expect(result.validation.valid, result.validation.error).toBe(true);
    expect(result.graph.Nodes.some(node => node.SubType === 11)).toBe(true);
  });

  it('maps branch records to Choice node options', () => {
    const result = convertStoryTreeToVNGraph({
      story: storyFixture(),
      segments: [
        segment('seg-1', 'main', null, 'A choice is coming.'),
        segment('seg-2', 'main', 'seg-1', 'Main path continues.'),
        segment('seg-b1', 'branch-1', 'seg-1', 'Branch path begins.'),
      ],
      branches: [{
        id: 'branch-1',
        title: 'Branch title',
        description: null,
        sourceSegmentId: 'seg-1',
        storyId: 'story-1',
        userDirection: 'Take the hidden path',
        characterStateSnapshot: null,
        forkTimeline: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        ownerId: 'user-1',
        visibility: 'PRIVATE',
        model: null,
      } as any],
    });

    expect(result.validation.valid, result.validation.error).toBe(true);
    const choice = result.graph.Nodes.find(node => node.SubType === 5);
    expect(choice).toBeTruthy();
    expect(choice?.Data.Options.Items?.[0].ObjectValue?.Text.StringValue).toBe('Take the hidden path');
  });
});

function storyFixture() {
  return {
    id: 'story-1',
    title: 'Sample Story',
    description: '',
    author: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    rootSegmentId: 'seg-1',
    era: null,
    genre: null,
    storyType: null,
    coverImageUrl: null,
    ownerId: 'user-1',
    visibility: 'PRIVATE',
    publishedAt: null,
  } as any;
}

function segment(id: string, branchId: string, parentSegmentId: string | null, content: string) {
  return {
    id,
    title: null,
    content,
    isBranchPoint: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    storyId: 'story-1',
    branchId,
    parentSegmentId,
    imageUrls: [],
    timeline: null,
    historicalReferences: null,
    narrativePace: null,
    mood: null,
    characterIds: [],
    visibility: 'PRIVATE',
  } as any;
}

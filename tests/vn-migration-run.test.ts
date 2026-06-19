import { describe, expect, it } from 'vitest';
import {
  buildVNMigrationRunCreateData,
  buildVNMigrationRunProgressData,
  computeStorySourceHash,
} from '@/lib/vn/migration-run';

describe('VN migration run metadata helpers', () => {
  it('builds run create data with safe defaults', () => {
    expect(buildVNMigrationRunCreateData({
      mode: 'persist',
      dryRun: false,
      storyCount: 2,
      reportPath: 'exports/aivn-migration/reports/run.json',
    })).toEqual({
      mode: 'persist',
      status: 'running',
      dryRun: false,
      storyCount: 2,
      segmentCount: 0,
      branchCount: 0,
      validCount: 0,
      invalidCount: 0,
      skippedCount: 0,
      reportPath: 'exports/aivn-migration/reports/run.json',
      errorSummary: null,
    });
  });

  it('builds sparse progress update data', () => {
    expect(buildVNMigrationRunProgressData({ validCount: 3, invalidCount: 1 })).toEqual({
      validCount: 3,
      invalidCount: 1,
    });
    expect(buildVNMigrationRunProgressData({ skippedCount: 2 }, null)).toEqual({
      skippedCount: 2,
      reportPath: null,
    });
  });

  it('computes stable source hashes from ordered story inputs', () => {
    const input = {
      story: storyFixture(),
      segments: [
        segment('seg-2', 'main', 'seg-1', 'Second.', '2026-06-19T00:00:02.000Z'),
        segment('seg-1', 'main', null, 'First.', '2026-06-19T00:00:01.000Z'),
      ],
      branches: [branch('branch-1', 'seg-1')],
    };

    expect(computeStorySourceHash(input)).toBe(computeStorySourceHash({
      ...input,
      segments: [...input.segments].reverse(),
    }));
  });

  it('changes source hash when source content changes', () => {
    const original = {
      story: storyFixture(),
      segments: [segment('seg-1', 'main', null, 'First.')],
      branches: [],
    };
    const changed = {
      ...original,
      segments: [segment('seg-1', 'main', null, 'Changed.')],
    };

    expect(computeStorySourceHash(original)).not.toBe(computeStorySourceHash(changed));
  });
});

function storyFixture() {
  return {
    id: 'story-1',
    title: 'Sample Story',
    description: null,
    author: null,
    createdAt: new Date('2026-06-19T00:00:00.000Z'),
    updatedAt: new Date('2026-06-19T00:00:00.000Z'),
    rootSegmentId: null,
    era: null,
    genre: null,
    storyType: null,
    coverImageUrl: null,
    ownerId: 'user-1',
    visibility: 'PRIVATE',
    publishedAt: null,
  } as any;
}

function segment(
  id: string,
  branchId: string,
  parentSegmentId: string | null,
  content: string,
  createdAt = '2026-06-19T00:00:00.000Z',
) {
  return {
    id,
    title: null,
    content,
    isBranchPoint: false,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
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

function branch(id: string, sourceSegmentId: string) {
  return {
    id,
    title: `Branch ${id}`,
    description: null,
    sourceSegmentId,
    storyId: 'story-1',
    userDirection: 'Take the branch',
    characterStateSnapshot: null,
    forkTimeline: null,
    createdAt: new Date('2026-06-19T00:00:00.000Z'),
    updatedAt: new Date('2026-06-19T00:00:00.000Z'),
    ownerId: 'user-1',
    visibility: 'PRIVATE',
    model: null,
  } as any;
}

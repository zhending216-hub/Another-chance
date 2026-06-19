import { describe, expect, it } from 'vitest';
import {
  PHASE9_ENTRY_CHAPTER_ASSET_ID,
  buildPhase9DryRunReport,
  convertStoryTreeToPhase9Chapters,
  phase9BranchChapterAssetId,
  type Phase9ChapterResult,
} from '@/lib/vn/phase9-skipped-migration';
import type { BulkMigrationCorpus } from '@/lib/vn/bulk-migration';
import type { VNGraphSaveData } from '@/lib/vn/types';

describe('Phase 9 skipped-story migration', () => {
  it('recovers a missing-parent mainline without mutating source rows', () => {
    const record = storyRecord('story-missing-parent', [
      segment('seg-1', 'story-missing-parent', 'main', 'missing-parent', 'Recovered first paragraph.'),
      segment('seg-2', 'story-missing-parent', 'main', 'seg-1', 'Recovered second paragraph.'),
    ], []);

    const result = convertStoryTreeToPhase9Chapters(record as any);

    expect(result.validation.valid, result.validation.error).toBe(true);
    expect(result.chapters).toHaveLength(1);
    expect(result.plan.missingParentSegmentIds).toEqual(['seg-1']);
    expect(paragraphTexts(result.chapters[0].graph)).toEqual([
      'Recovered first paragraph.',
      'Recovered second paragraph.',
    ]);
  });

  it('splits nested branch-source choices into ChapterNode handoffs', () => {
    const record = nestedStoryRecord();

    const result = convertStoryTreeToPhase9Chapters(record as any);

    expect(result.validation.valid, result.validation.error).toBe(true);
    expect(result.chapters.map(chapter => chapter.assetId)).toEqual([
      PHASE9_ENTRY_CHAPTER_ASSET_ID,
      phase9BranchChapterAssetId('branch-nested'),
    ]);
    expect(result.chapters.every(chapter => chapter.validation.valid)).toBe(true);

    const entry = chapter(result.chapters, PHASE9_ENTRY_CHAPTER_ASSET_ID);
    const chapterNode = entry.graph.Nodes.find(node => node.SubType === 3);
    expect(chapterNode?.Data.NextChapterPath.StringValue).toBe(phase9BranchChapterAssetId('branch-nested'));
    expect(chapterNode?.Outputs.Next).toHaveLength(1);

    const nested = chapter(result.chapters, phase9BranchChapterAssetId('branch-nested'));
    expect(paragraphTexts(nested.graph)).toEqual(['Nested branch paragraph.']);
  });

  it('dry-runs only supported Phase 9 skipped stories', () => {
    const corpus: BulkMigrationCorpus = {
      generatedVNChapterCount: 0,
      generatedAssetCount: 0,
      stories: [
        nestedStoryRecord() as any,
        storyRecord('story-missing-parent', [
          segment('seg-missing-1', 'story-missing-parent', 'main', 'missing-parent'),
        ], []) as any,
        storyRecord('story-orphan-branch', [
          segment('seg-orphan-1', 'story-orphan-branch', 'main', null),
        ], [branch('branch-orphan', 'story-orphan-branch', 'missing-source')]) as any,
      ],
    };

    const report = buildPhase9DryRunReport(corpus, '2026-06-19T00:00:00.000Z');

    expect(report.mode).toBe('phase9-dry-run');
    expect(report.summary.targetStoryCount).toBe(2);
    expect(report.summary.validStoryCount).toBe(2);
    expect(report.summary.invalidStoryCount).toBe(0);
    expect(report.summary.chapterCount).toBe(3);
    expect(report.stories.map(story => story.storyId)).toEqual([
      'story-nested',
      'story-missing-parent',
    ]);
  });
});

function nestedStoryRecord() {
  return storyRecord('story-nested', [
    segment('seg-main-1', 'story-nested', 'main', null, 'Main one.'),
    segment('seg-main-2', 'story-nested', 'main', 'seg-main-1', 'Main two.'),
    segment('seg-inline-1', 'story-nested', 'branch-inline', 'seg-main-2', 'Inline branch paragraph.'),
    segment('seg-nested-1', 'story-nested', 'branch-nested', 'seg-inline-1', 'Nested branch paragraph.'),
  ], [
    branch('branch-inline', 'story-nested', 'seg-main-2'),
    branch('branch-nested', 'story-nested', 'seg-inline-1'),
  ]);
}

function chapter(chapters: Phase9ChapterResult[], assetId: string): Phase9ChapterResult {
  const match = chapters.find(item => item.assetId === assetId);
  expect(match).toBeTruthy();
  return match!;
}

function paragraphTexts(graph: VNGraphSaveData): string[] {
  return graph.Nodes
    .filter(node => node.SubType === 2)
    .map(node => node.Data.Lines.Items?.[0].ObjectValue?.Text.StringValue ?? '');
}

function storyRecord(
  id: string,
  segments: ReturnType<typeof segment>[],
  branches: ReturnType<typeof branch>[],
): BulkMigrationCorpus['stories'][number] {
  return {
    story: story(id),
    segments,
    branches,
    generatedVNChapters: [],
  } as any;
}

function story(id: string) {
  return {
    id,
    title: `Story ${id}`,
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
  storyId: string,
  branchId: string,
  parentSegmentId: string | null,
  content = 'A paragraph.',
) {
  return {
    id,
    title: null,
    content,
    isBranchPoint: false,
    createdAt: new Date('2026-06-19T00:00:00.000Z'),
    updatedAt: new Date('2026-06-19T00:00:00.000Z'),
    storyId,
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

function branch(id: string, storyId: string, sourceSegmentId: string) {
  return {
    id,
    title: `Branch ${id}`,
    description: null,
    sourceSegmentId,
    storyId,
    userDirection: `Take ${id}`,
    characterStateSnapshot: null,
    forkTimeline: null,
    createdAt: new Date('2026-06-19T00:00:00.000Z'),
    updatedAt: new Date('2026-06-19T00:00:00.000Z'),
    ownerId: 'user-1',
    visibility: 'PRIVATE',
    model: null,
  } as any;
}

import { describe, expect, it } from 'vitest';
import {
  buildBulkMigrationAuditReport,
  buildBulkMigrationDryRunReport,
  selectPersistCandidates,
  type BulkMigrationCorpus,
  type GeneratedVNChapterSummary,
} from '@/lib/vn/bulk-migration';
import { resolveMigrationReportPath } from '@/lib/vn/migration-report';

describe('bulk VN migration audit', () => {
  it('classifies eligible, skipped, duplicate, and anomalous stories', () => {
    const corpus = corpusFixture([
      storyRecord('story-low', [segment('seg-low-1', 'story-low', 'main', null)], []),
      storyRecord('story-empty', [], []),
      storyRecord(
        'story-duplicate',
        [segment('seg-dup-1', 'story-duplicate', 'main', null)],
        [],
        [chapter('chapter-1', 'story-duplicate', 'migration-sample')],
      ),
      storyRecord(
        'story-orphan-segment',
        [
          segment('seg-orphan-1', 'story-orphan-segment', 'main', null),
          segment('seg-orphan-2', 'story-orphan-segment', 'missing-branch', 'seg-orphan-1'),
        ],
        [],
      ),
      storyRecord(
        'story-cross-parent',
        [segment('seg-cross-1', 'story-cross-parent', 'main', 'seg-low-1')],
        [],
      ),
      storyRecord(
        'story-nested-branch',
        [
          segment('seg-nested-1', 'story-nested-branch', 'main', null),
          segment('seg-nested-2', 'story-nested-branch', 'branch-1', 'seg-nested-1'),
          segment('seg-nested-3', 'story-nested-branch', 'branch-2', 'seg-nested-2'),
        ],
        [
          branch('branch-1', 'story-nested-branch', 'seg-nested-1'),
          branch('branch-2', 'story-nested-branch', 'seg-nested-2'),
        ],
      ),
    ]);

    const report = buildBulkMigrationAuditReport(corpus, { generatedAt: '2026-06-19T00:00:00.000Z' });

    expect(report.mode).toBe('audit');
    expect(report.summary.storyCount).toBe(6);
    expect(report.summary.eligibleCount).toBe(2);
    expect(report.summary.skippedCount).toBe(3);
    expect(report.summary.duplicateCount).toBe(1);
    expect(report.summary.anomalies.zeroSegmentStories).toBe(1);
    expect(report.summary.anomalies.orphanBranchSegments).toBe(1);
    expect(report.summary.anomalies.crossStoryParentSegments).toBe(1);
    expect(report.summary.anomalies.branchSourcesOutsideMainline).toBe(1);
    expect(report.summary.anomalies.existingMigrationChapters).toBe(1);

    expect(report.stories.find(story => story.storyId === 'story-low')?.status).toBe('eligible');
    expect(report.stories.find(story => story.storyId === 'story-empty')?.skipReasons).toContain('zero_segments');
    expect(report.stories.find(story => story.storyId === 'story-duplicate')?.status).toBe('duplicate');
    expect(report.stories.find(story => story.storyId === 'story-orphan-segment')?.risk).toBe('medium');
    expect(report.stories.find(story => story.storyId === 'story-nested-branch')?.status).toBe('skipped');
    expect(report.stories.find(story => story.storyId === 'story-nested-branch')?.skipReasons).toContain('nested_branch_source_requires_chapter_handoff');
    expect(report.stories.find(story => story.storyId === 'story-cross-parent')?.risk).toBe('high');
    expect(report.stories.find(story => story.storyId === 'story-nested-branch')?.risk).toBe('high');
  });

  it('labels large stories as medium or high risk', () => {
    const mediumSegments = Array.from({ length: 21 }, (_, index) => (
      segment(`seg-medium-${index}`, 'story-medium', 'main', index === 0 ? null : `seg-medium-${index - 1}`)
    ));
    const highSegments = Array.from({ length: 119 }, (_, index) => (
      segment(`seg-high-${index}`, 'story-high', 'main', index === 0 ? null : `seg-high-${index - 1}`)
    ));

    const report = buildBulkMigrationAuditReport(corpusFixture([
      storyRecord('story-medium', mediumSegments, []),
      storyRecord('story-high', highSegments, []),
    ]));

    expect(report.stories.find(story => story.storyId === 'story-medium')?.risk).toBe('medium');
    expect(report.stories.find(story => story.storyId === 'story-high')?.risk).toBe('high');
  });
});

describe('bulk VN migration dry-run', () => {
  it('converts eligible stories and validates terminal graphs', () => {
    const report = buildBulkMigrationDryRunReport(corpusFixture([
      storyRecord('story-linear', [
        segment('seg-linear-1', 'story-linear', 'main', null, 'First paragraph.'),
        segment('seg-linear-2', 'story-linear', 'main', 'seg-linear-1', 'Second paragraph.'),
      ], []),
      storyRecord('story-branch', [
        segment('seg-branch-1', 'story-branch', 'main', null, 'Choice setup.'),
        segment('seg-branch-2', 'story-branch', 'main', 'seg-branch-1', 'Mainline continuation.'),
        segment('seg-branch-b1', 'story-branch', 'branch-1', 'seg-branch-1', 'Branch continuation.'),
      ], [branch('branch-1', 'story-branch', 'seg-branch-1')]),
    ]));

    expect(report.mode).toBe('dry-run');
    expect(report.summary.validCount).toBe(2);
    expect(report.summary.invalidCount).toBe(0);
    expect(report.stories.every(story => story.valid === true)).toBe(true);
    expect(report.stories.every(story => typeof story.nodeCount === 'number' && story.nodeCount > 0)).toBe(true);
  });

  it('skips unsupported complex graph shapes without persisting anything', () => {
    const report = buildBulkMigrationDryRunReport(corpusFixture([
      storyRecord('story-complex', [
        segment('seg-complex-branch', 'story-complex', 'branch-1', 'missing-source', 'Unreachable branch segment.'),
      ], [branch('branch-1', 'story-complex', 'missing-source')]),
    ]));

    expect(report.summary.validCount).toBe(0);
    expect(report.summary.invalidCount).toBe(0);
    expect(report.summary.skippedCount).toBe(1);
    expect(report.stories[0].status).toBe('skipped');
    expect(report.stories[0].valid).toBeNull();
    expect(report.stories[0].validationErrors).toContain('orphan_branch_source');
    expect('persistedChapterId' in report.stories[0]).toBe(false);
  });



  it('selects low-risk valid persist candidates with batch size', () => {
    const lowStories = Array.from({ length: 6 }, (_, index) => (
      storyRecord(`story-low-${index}`, [segment(`seg-low-${index}`, `story-low-${index}`, 'main', null)], [])
    ));
    const mediumSegments = Array.from({ length: 21 }, (_, index) => (
      segment(`seg-medium-${index}`, 'story-medium', 'main', index === 0 ? null : `seg-medium-${index - 1}`)
    ));
    const report = buildBulkMigrationDryRunReport(corpusFixture([
      ...lowStories,
      storyRecord('story-medium', mediumSegments, []),
      storyRecord('story-empty', [], []),
    ]));

    const selected = selectPersistCandidates(report, { batchSize: 5 });

    expect(selected).toHaveLength(5);
    expect(selected.every(story => story.status === 'valid')).toBe(true);
    expect(selected.every(story => story.risk === 'low')).toBe(true);
    expect(selected.map(story => story.storyId)).toEqual([
      'story-low-0',
      'story-low-1',
      'story-low-2',
      'story-low-3',
      'story-low-4',
    ]);
  });

  it('skips zero-segment and duplicate migration stories in dry-run', () => {
    const report = buildBulkMigrationDryRunReport(corpusFixture([
      storyRecord('story-empty', [], []),
      storyRecord(
        'story-duplicate',
        [segment('seg-dup-1', 'story-duplicate', 'main', null)],
        [],
        [chapter('chapter-1', 'story-duplicate', 'migration-sample')],
      ),
    ]));

    expect(report.summary.validCount).toBe(0);
    expect(report.summary.invalidCount).toBe(0);
    expect(report.summary.skippedCount).toBe(1);
    expect(report.summary.duplicateCount).toBe(1);
    expect(report.stories.find(story => story.storyId === 'story-empty')?.status).toBe('skipped');
    expect(report.stories.find(story => story.storyId === 'story-duplicate')?.status).toBe('duplicate');
  });
});

describe('bulk migration report paths', () => {
  it('allows report paths under exports only', () => {
    expect(resolveMigrationReportPath('exports/aivn-migration/reports/audit.json', '/repo'))
      .toBe('/repo/exports/aivn-migration/reports/audit.json');
    expect(() => resolveMigrationReportPath('reports/audit.json', '/repo')).toThrow('exports');
    expect(() => resolveMigrationReportPath('../audit.json', '/repo')).toThrow('exports');
  });
});

function corpusFixture(stories: BulkMigrationCorpus['stories']): BulkMigrationCorpus {
  return {
    generatedVNChapterCount: stories.reduce((count, story) => count + story.generatedVNChapters.length, 0),
    generatedAssetCount: 0,
    stories,
  };
}

function storyRecord(
  id: string,
  segments: ReturnType<typeof segment>[],
  branches: ReturnType<typeof branch>[],
  generatedVNChapters: GeneratedVNChapterSummary[] = [],
): BulkMigrationCorpus['stories'][number] {
  return {
    story: story(id),
    segments,
    branches,
    generatedVNChapters,
  };
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

function chapter(id: string, storyId: string, branchId: string): GeneratedVNChapterSummary {
  return {
    id,
    storyId,
    branchId,
    status: 'valid',
    migrationRunId: null,
    migrationKind: null,
    sourceHash: null,
    createdAt: new Date('2026-06-19T00:00:00.000Z'),
  };
}
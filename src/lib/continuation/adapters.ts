import type { PacingPace, StorySegment as SegmentForAI, TimelineEvent, HistoricalReference } from '@/types/story';

type SegmentLike = {
  id: string;
  title?: string | null;
  content: string;
  isBranchPoint: boolean;
  createdAt: Date | string;
  updatedAt: Date | string;
  storyId: string;
  branchId: string;
  parentSegmentId?: string | null;
  imageUrls?: string[] | null;
  imagePrompts?: string[] | null;
  imageStyle?: string | null;
  timeline?: unknown;
  characterIds?: string[] | null;
  historicalReferences?: unknown;
  narrativePace?: string | null;
  mood?: string | null;
};

const PACING_VALUES = new Set<PacingPace>(['rush', 'detailed', 'pause', 'summary']);

function dateString(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : value;
}

function timelineValue(value: unknown): TimelineEvent | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as TimelineEvent
    : undefined;
}

function historicalReferencesValue(value: unknown): HistoricalReference[] | undefined {
  return Array.isArray(value) ? value as HistoricalReference[] : undefined;
}

function pacingValue(value?: string | null): PacingPace | undefined {
  return value && PACING_VALUES.has(value as PacingPace) ? value as PacingPace : undefined;
}

export function toSegmentForAI(segment: SegmentLike): SegmentForAI {
  return {
    id: segment.id,
    title: segment.title ?? undefined,
    content: segment.content,
    isBranchPoint: segment.isBranchPoint,
    createdAt: dateString(segment.createdAt),
    updatedAt: dateString(segment.updatedAt),
    storyId: segment.storyId,
    branchId: segment.branchId,
    parentSegmentId: segment.parentSegmentId ?? undefined,
    imageUrls: segment.imageUrls ?? [],
    imagePrompts: segment.imagePrompts ?? undefined,
    imageStyle: segment.imageStyle ?? undefined,
    timeline: timelineValue(segment.timeline),
    characterIds: segment.characterIds ?? undefined,
    historicalReferences: historicalReferencesValue(segment.historicalReferences),
    narrativePace: pacingValue(segment.narrativePace),
    mood: segment.mood ?? undefined,
  };
}

export function toSegmentsForAI(segments: SegmentLike[]): SegmentForAI[] {
  return segments.map(toSegmentForAI);
}

export type { SegmentForAI };

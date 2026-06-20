import type { NextResponse } from 'next/server';
import type { Story, StorySegment } from '@/lib/prisma';

export interface ContinuationContext {
  userId: string;
  storyId: string;
  branchId: string;
  story: Story;
  chain: StorySegment[];
  tailSegment: StorySegment;
}

export type ContinuationContextResult =
  | { ok: true; context: ContinuationContext }
  | { ok: false; response: NextResponse };

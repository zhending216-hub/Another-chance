import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canViewStory } from '@/lib/permissions';
import { getOrderedChain } from '@/lib/chain-helpers';
import type { ContinuationContextResult } from './types';

export async function loadContinuationContext(
  request: NextRequest,
  storyId: string | undefined,
  branchId: string,
): Promise<ContinuationContextResult> {
  const userId = await getUserIdFromRequest(request);
  if (!userId) {
    return { ok: false, response: NextResponse.json({ error: '请先登录' }, { status: 401 }) };
  }

  if (!storyId) {
    return { ok: false, response: NextResponse.json({ error: '缺少参数' }, { status: 400 }) };
  }

  const story = await prisma.story.findUnique({ where: { id: storyId } });
  if (!story) {
    return { ok: false, response: NextResponse.json({ error: '故事不存在' }, { status: 404 }) };
  }

  if (!canViewStory(story, userId)) {
    return { ok: false, response: NextResponse.json({ error: '无权查看' }, { status: 403 }) };
  }

  const chain = await getOrderedChain(storyId, branchId);
  if (chain.length === 0) {
    return { ok: false, response: NextResponse.json({ error: '该分支没有段落' }, { status: 404 }) };
  }

  return {
    ok: true,
    context: {
      userId,
      storyId,
      branchId,
      story,
      chain,
      tailSegment: chain[chain.length - 1],
    },
  };
}

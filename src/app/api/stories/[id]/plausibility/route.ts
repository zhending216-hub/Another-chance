import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canViewStory } from '@/lib/permissions';
import { getOrderedChain } from '@/lib/chain-helpers';
import { plausibilityChecker } from '@/lib/plausibility-checker';
import { callAIText } from '@/lib/ai-client';
import { characterManager } from '@/lib/character-engine';

/**
 * POST /api/stories/[id]/plausibility
 * 对指定段落或最新内容进行合理性检测
 *
 * Body:
 * - segmentId?: string - 指定检测的段落ID（默认检测最新段落）
 * - branchId?: string - 分支ID（默认 main）
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const { id: storyId } = params;
    const { segmentId, branchId = 'main' } = await request.json();

    if (!storyId) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    }

    if (!canViewStory(story, userId)) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    // 获取段落链
    const chain = await getOrderedChain(storyId, branchId);
    if (chain.length === 0) {
      return NextResponse.json({ error: '该分支没有段落' }, { status: 404 });
    }

    // 确定要检测的段落
    let targetSegment;
    let existingContent: string;

    if (segmentId) {
      const idx = chain.findIndex(s => s.id === segmentId);
      if (idx === -1) {
        return NextResponse.json({ error: '段落不存在' }, { status: 404 });
      }
      targetSegment = chain[idx];
      existingContent = chain.slice(0, idx).map(s => s.content).join('\n');
    } else {
      targetSegment = chain[chain.length - 1];
      existingContent = chain.slice(0, -1).map(s => s.content).join('\n');
    }

    // 获取角色列表
    const characters = await characterManager.list(storyId);
    const characterNames = characters.map(c => c.name);

    // 执行合理性检测
    const report = await plausibilityChecker.check({
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
      genre: story.genre ?? undefined,
      existingContent,
      newContent: targetSegment.content,
      characterNames,
      worldSettings: (story as any).worldSettings,
    }, (p: string) => callAIText(p, { maxTokens: 1500, story: story as any }));

    return NextResponse.json({
      success: true,
      report,
      segmentId: targetSegment.id,
      segmentTitle: targetSegment.title,
    });
  } catch (error) {
    console.error('合理性检测失败:', error);
    return NextResponse.json(
      { error: '合理性检测失败', details: String(error) },
      { status: 500 },
    );
  }
}

/**
 * GET /api/stories/[id]/plausibility
 * 获取故事的合理性检测历史记录
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const { id: storyId } = params;
    if (!storyId) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    }

    if (!canViewStory(story, userId)) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    // 从段落中提取已存储的检测结果（如果有）
    const segments = await prisma.storySegment.findMany({
      where: { storyId },
      select: { id: true, title: true, createdAt: true },
      orderBy: { createdAt: 'desc' },
      take: 10,
    });

    return NextResponse.json({
      success: true,
      segments,
      note: '使用 POST 方法对指定段落进行合理性检测',
    });
  } catch (error) {
    console.error('获取检测历史失败:', error);
    return NextResponse.json(
      { error: '获取检测历史失败', details: String(error) },
      { status: 500 },
    );
  }
}
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canViewStory } from '@/lib/permissions';
import { callAIText } from '@/lib/ai-client';
import { buildVNGenerationContext } from '@/lib/vn/context-builder';
import { generateVNGraphPreview } from '@/lib/vn/generation-service';
import { saveVNChapter } from '@/lib/vn/storage';

interface VNContinueRequestBody {
  branchId?: string;
  sourceSegmentId?: string;
  maxRepairAttempts?: number;
  requireEndingTerminal?: boolean;
  includeDebug?: boolean;
  persist?: boolean;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const storyId = params.id;
    if (!storyId) {
      return NextResponse.json({ error: '缺少参数' }, { status: 400 });
    }

    const body = await request.json().catch(() => ({})) as VNContinueRequestBody;
    const branchId = body.branchId || 'main';
    const maxRepairAttempts = Math.max(0, Math.min(body.maxRepairAttempts ?? 1, 2));
    const requireEndingTerminal = body.requireEndingTerminal ?? true;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    }

    if (!canViewStory(story, userId)) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const context = await buildVNGenerationContext({
      storyId,
      branchId,
      sourceSegmentId: body.sourceSegmentId,
      maxChainSegments: 12,
    });

    const result = await generateVNGraphPreview({
      context,
      callAIText: (prompt, options) => callAIText(prompt, {
        systemPrompt: options?.systemPrompt,
        maxTokens: options?.maxTokens,
        story: story as any,
        priority: options?.priority,
      }),
      storyForAI: story as any,
      maxRepairAttempts,
      requireEndingTerminal,
      includeDebug: !!body.includeDebug,
    });

    const chapter = body.persist
      ? await saveVNChapter({
        storyId,
        branchId,
        sourceSegmentId: context.sourceSegmentId,
        createdById: userId,
        result,
      })
      : null;

    return NextResponse.json({
      success: result.success,
      chapter,
      graph: result.graph,
      validation: result.validation,
      rawAIText: body.includeDebug ? result.rawAIText : undefined,
      repairAttempts: result.repairAttempts,
      prompt: result.prompt,
      repairPrompts: result.repairPrompts,
      contextSummary: {
        storyId,
        branchId,
        sourceSegmentId: context.sourceSegmentId,
        segmentCount: context.chain.length,
        characterCount: context.characters.length,
        eventCount: context.events.length,
      },
    }, { status: result.success ? 200 : 422 });
  } catch (error) {
    console.error('[vn-continue] VNGraph 生成失败:', error);
    return NextResponse.json({
      success: false,
      error: 'VNGraph 生成失败',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

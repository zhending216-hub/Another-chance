import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { callAIText } from '@/lib/ai-client';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canEditStory, canViewStory } from '@/lib/permissions';
import {
  buildAIVNGenerationContext,
  buildVNGenerationContext,
} from '@/lib/vn/context-builder';
import { generateFusedAIVNGraphPreview } from '@/lib/vn/fused-generation-service';
import { saveVNChapter } from '@/lib/vn/storage';
import type { GenerationForkContext, GenerationVisualState } from '@/lib/generation/contracts';

interface AIVNGenerateRequestBody {
  branchId?: string;
  sourceSegmentId?: string;
  maxRepairAttempts?: number;
  requireEndingTerminal?: boolean;
  includeDebug?: boolean;
  persist?: boolean;
  fork?: GenerationForkContext | null;
  visualState?: GenerationVisualState | null;
  includeGeneratedAssets?: boolean;
  chapterId?: string;
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const storyId = params.id;
    if (!storyId) return NextResponse.json({ error: '缺少参数' }, { status: 400 });

    const body = await request.json().catch(() => ({})) as AIVNGenerateRequestBody;
    const branchId = body.branchId || 'main';
    const maxRepairAttempts = Math.max(0, Math.min(body.maxRepairAttempts ?? 1, 2));
    const requireEndingTerminal = body.requireEndingTerminal ?? true;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    if (!canViewStory(story, userId)) return NextResponse.json({ error: '无权查看' }, { status: 403 });
    if (body.persist && !canEditStory(story, userId)) {
      return NextResponse.json({ error: '无权保存 AIVN 章节' }, { status: 403 });
    }

    const contextOptions = {
      storyId,
      branchId,
      sourceSegmentId: body.sourceSegmentId,
      maxChainSegments: 12,
    };
    const context = await buildVNGenerationContext(contextOptions);
    const aivnContext = await buildAIVNGenerationContext({
      ...contextOptions,
      mode: body.persist ? 'vnGraphPersist' : 'vnGraphPreview',
      fork: body.fork ?? null,
      visualState: body.visualState ?? null,
      includeGeneratedAssets: body.includeGeneratedAssets,
      chapterId: body.chapterId,
    });

    const preview = await generateFusedAIVNGraphPreview({
      context,
      aivnContext,
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
        result: preview.result,
        migrationKind: 'aivn-fused-generation-v1',
      })
      : null;

    return NextResponse.json({
      success: preview.result.success,
      mode: aivnContext.mode,
      chapter,
      graph: preview.result.graph,
      validation: preview.result.validation,
      rawAIText: body.includeDebug ? preview.result.rawAIText : undefined,
      repairAttempts: preview.result.repairAttempts,
      prompt: preview.result.prompt,
      repairPrompts: preview.result.repairPrompts,
      contextSummary: preview.contextSummary,
    }, { status: preview.result.success ? 200 : 422 });
  } catch (error) {
    console.error('[aivn-generate] fused AIVN generation failed:', error);
    return NextResponse.json({
      success: false,
      error: 'AIVN 生成失败',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

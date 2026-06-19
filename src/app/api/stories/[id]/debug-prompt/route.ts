import { NextRequest, NextResponse } from 'next/server';
import { buildFullPrompt } from '@/lib/prompt-builder';
import { getOrderedChain } from '@/lib/chain-helpers';
import prisma from '@/lib/prisma';

/**
 * 调试端点：查看完整的 prompt 结构
 *
 * 用法：GET /api/stories/{storyId}/debug-prompt?branchId=main
 */
export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const storyId = params.id;
    const branchId = request.nextUrl.searchParams.get('branchId') || 'main';

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    }

    const chain = await getOrderedChain(storyId, branchId);
    if (chain.length === 0) {
      return NextResponse.json({ error: '该分支没有段落' }, { status: 404 });
    }

    const tailSegment = chain[chain.length - 1];

    const result = await buildFullPrompt({
      storyId,
      branchId,
      tailSegment: tailSegment as any,
      chain: chain as any,
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
    });

    // 解析 prompt 的各个部分
    const sections = result.prompt.split('\n\n').map(section => {
      const lines = section.split('\n');
      const title = lines[0].startsWith('##') || lines[0].startsWith('【')
        ? lines[0]
        : lines[0].slice(0, 50);
      return {
        title,
        content: section,
        length: section.length,
      };
    });

    return NextResponse.json({
      story: {
        id: storyId,
        title: story.title,
        genre: story.genre,
        era: story.era,
      },
      branch: {
        id: branchId,
        segmentCount: chain.length,
        tailSegmentId: tailSegment.id,
      },
      prompt: {
        full: result.prompt,
        length: result.prompt.length,
        sections,
      },
      characters: {
        known: result.knownCharacterNames,
        registered: result.registeredCharacterNames,
      },
    });
  } catch (error) {
    console.error('调试 prompt 失败:', error);
    return NextResponse.json(
      { error: '调试失败', details: String(error) },
      { status: 500 },
    );
  }
}
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canEditStory, canViewStory } from '@/lib/permissions';
import { revalidateStoredVNChapter } from '@/lib/vn/storage';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string; chapterId: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    const story = await prisma.story.findUnique({ where: { id: params.id } });
    if (!story) return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    if (!canViewStory(story, userId ?? undefined)) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const chapter = await prisma.generatedVNChapter.findFirst({
      where: { id: params.chapterId, storyId: params.id },
    });
    if (!chapter) return NextResponse.json({ error: 'VN chapter 不存在' }, { status: 404 });

    const validation = revalidateStoredVNChapter(chapter.graphJson, { requireEndingTerminal: true });
    return NextResponse.json({ success: true, chapter, validation });
  } catch (error) {
    console.error('[vn-chapters] get failed:', error);
    return NextResponse.json({ error: '获取 VN chapter 失败' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: { id: string; chapterId: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const story = await prisma.story.findUnique({ where: { id: params.id } });
    if (!story) return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    if (!canEditStory(story, userId)) {
      return NextResponse.json({ error: '无权删除' }, { status: 403 });
    }

    const chapter = await prisma.generatedVNChapter.findFirst({
      where: { id: params.chapterId, storyId: params.id },
      select: { id: true },
    });
    if (!chapter) return NextResponse.json({ error: 'VN chapter 不存在' }, { status: 404 });

    await prisma.generatedVNChapter.delete({ where: { id: params.chapterId } });
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('[vn-chapters] delete failed:', error);
    return NextResponse.json({ error: '删除 VN chapter 失败' }, { status: 500 });
  }
}

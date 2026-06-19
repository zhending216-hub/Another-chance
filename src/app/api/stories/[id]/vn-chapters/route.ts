import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canViewStory } from '@/lib/permissions';

export async function GET(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    const storyId = params.id;
    const branchId = request.nextUrl.searchParams.get('branchId') || undefined;

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    if (!canViewStory(story, userId ?? undefined)) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const chapters = await prisma.generatedVNChapter.findMany({
      where: { storyId, ...(branchId ? { branchId } : {}) },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        storyId: true,
        branchId: true,
        sourceSegmentId: true,
        status: true,
        validationError: true,
        repairAttempts: true,
        createdById: true,
        migrationRunId: true,
        migrationKind: true,
        sourceHash: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ success: true, chapters });
  } catch (error) {
    console.error('[vn-chapters] list failed:', error);
    return NextResponse.json({ error: '获取 VN chapters 失败' }, { status: 500 });
  }
}

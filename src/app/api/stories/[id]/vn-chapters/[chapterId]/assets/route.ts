import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { callAIText } from '@/lib/ai-client';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canEditStory, canViewStory } from '@/lib/permissions';
import type { ImageStyle } from '@/lib/image-generator';
import { generateAIVNChapterAssetPreview, type AIVNChapterAssetCategory } from '@/lib/vn/asset-generation-service';
import type { VNGeneratedAssetRecord } from '@/lib/vn/asset-bridge';
import type { VNGraphSaveData } from '@/lib/vn/types';

interface GenerateAssetBody {
  category?: AIVNChapterAssetCategory;
  style?: ImageStyle;
}

const AIVN_ASSET_CATEGORIES = ['Background', 'Tachi', 'Illustration'] as const;

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
      select: { id: true },
    });
    if (!chapter) return NextResponse.json({ error: 'VN chapter 不存在' }, { status: 404 });

    const assets = await prisma.generatedAsset.findMany({
      where: { storyId: params.id, chapterId: params.chapterId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        storyId: true,
        chapterId: true,
        assetId: true,
        scopedAssetId: true,
        category: true,
        publicUrl: true,
        localPath: true,
        mimeType: true,
        sha256: true,
        prompt: true,
        createdAt: true,
      },
    });

    return NextResponse.json({ success: true, assets });
  } catch (error) {
    console.error('[vn-assets] list failed:', error);
    return NextResponse.json({
      success: false,
      error: '获取 VN assets 失败',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: { id: string; chapterId: string } },
) {
  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) return NextResponse.json({ error: '请先登录' }, { status: 401 });

    const body = await request.json().catch(() => ({})) as GenerateAssetBody;
    const category = body.category || 'Background';
    if (!AIVN_ASSET_CATEGORIES.includes(category as AIVNChapterAssetCategory)) {
      return NextResponse.json({ error: '不支持的 VN 资产类型' }, { status: 400 });
    }

    const story = await prisma.story.findUnique({ where: { id: params.id } });
    if (!story) return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    if (!canEditStory(story, userId)) {
      return NextResponse.json({ error: '无权生成 VN 资产' }, { status: 403 });
    }

    const chapter = await prisma.generatedVNChapter.findFirst({
      where: { id: params.chapterId, storyId: params.id },
    });
    if (!chapter || !chapter.graphJson) {
      return NextResponse.json({ error: 'VN chapter 不存在或没有有效 graphJson' }, { status: 404 });
    }

    const sourceSegment = chapter.sourceSegmentId
      ? await prisma.storySegment.findUnique({ where: { id: chapter.sourceSegmentId } })
      : null;
    const segmentContent = sourceSegment?.content || story.description || story.title;

    const existingAssets = await prisma.generatedAsset.findMany({
      where: { storyId: story.id, chapterId: chapter.id },
    });
    const characters = await prisma.character.findMany({
      where: { storyId: story.id },
      select: { name: true },
    });
    const assetRecords: VNGeneratedAssetRecord[] = existingAssets.map(asset => ({
      assetId: asset.assetId,
      scopedAssetId: asset.scopedAssetId,
      category: asset.category,
      publicUrl: asset.publicUrl,
      localPath: asset.localPath,
    }));

    const preview = await generateAIVNChapterAssetPreview({
      storyTitle: story.title,
      chapterId: chapter.id,
      graph: chapter.graphJson as unknown as VNGraphSaveData,
      category,
      segmentId: `vn_${chapter.id}`,
      segmentContent,
      style: body.style || 'auto',
      genre: story.genre ?? undefined,
      storyDescription: story.description ?? undefined,
      callAIFn: (prompt: string) => callAIText(prompt, { maxTokens: 4000, story: story as any, priority: 'low' }),
      existingAssets: assetRecords,
      knownSpeakers: characters.map(character => character.name).filter(Boolean),
    });

    if (!preview.success) {
      return NextResponse.json({
        success: false,
        error: preview.error,
        warning: preview.warning,
        chapterId: chapter.id,
        category,
        image: preview.image,
        validation: preview.validation,
      });
    }

    const asset = await prisma.$transaction(async tx => {
      const saved = await tx.generatedAsset.upsert({
        where: { storyId_scopedAssetId: { storyId: story.id, scopedAssetId: preview.asset.scopedAssetId } },
        create: {
          storyId: story.id,
          chapterId: chapter.id,
          assetId: preview.asset.assetId,
          scopedAssetId: preview.asset.scopedAssetId,
          category: preview.asset.category,
          publicUrl: preview.asset.publicUrl,
          localPath: preview.asset.localPath,
          mimeType: preview.asset.mimeType,
          sha256: preview.asset.sha256,
          prompt: preview.asset.prompt,
        },
        update: {
          chapterId: chapter.id,
          category: preview.asset.category,
          publicUrl: preview.asset.publicUrl,
          localPath: preview.asset.localPath,
          mimeType: preview.asset.mimeType,
          sha256: preview.asset.sha256,
          prompt: preview.asset.prompt,
        },
      });
      if (preview.graphChanged) {
        await tx.generatedVNChapter.update({
          where: { id: chapter.id },
          data: { graphJson: preview.graph as any },
        });
      }
      return saved;
    });

    return NextResponse.json({
      success: true,
      asset,
      graph: preview.graph,
      graphChanged: preview.graphChanged,
      warning: preview.warning,
      validation: preview.validation,
    });
  } catch (error) {
    console.error('[vn-assets] generate failed:', error);
    return NextResponse.json({
      success: false,
      error: 'VN asset bridge 失败',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

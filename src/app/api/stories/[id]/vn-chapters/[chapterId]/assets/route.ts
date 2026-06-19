import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { callAIText } from '@/lib/ai-client';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canEditStory } from '@/lib/permissions';
import { generateImagesForSegment, type ImageStyle } from '@/lib/image-generator';
import {
  buildAIVNAssetIds,
  generatedAssetResolver,
  generatedAssetWhitelist,
  injectBackgroundAsset,
  type VNGeneratedAssetRecord,
} from '@/lib/vn/asset-bridge';
import type { VNGraphSaveData } from '@/lib/vn/types';
import { validateVNGraph } from '@/lib/vn/validator';

interface GenerateAssetBody {
  category?: 'Background';
  style?: ImageStyle;
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
    if (category !== 'Background') {
      return NextResponse.json({ error: '首版 VN asset bridge 只支持 Background' }, { status: 400 });
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

    const images = await generateImagesForSegment({
      segmentId: `vn_${chapter.id}`,
      segmentContent,
      style: body.style || 'auto',
      maxImages: 1,
      genre: story.genre ?? undefined,
      storyDescription: story.description ?? undefined,
      callAIFn: (prompt: string) => callAIText(prompt, { maxTokens: 4000, story: story as any, priority: 'low' }),
    });

    if (images.length === 0) {
      return NextResponse.json({
        success: false,
        warning: '图片生成未返回结果，VNGraph 保持 text-only。',
        chapterId: chapter.id,
      });
    }

    const image = images[0];
    const { assetId, scopedAssetId } = buildAIVNAssetIds({
      storyTitle: story.title,
      chapterId: chapter.id,
      category: 'Background',
      index: 0,
    });
    const localPath = publicUrlToLocalPath(image.url);
    const newAsset: VNGeneratedAssetRecord = {
      assetId,
      scopedAssetId,
      category: 'Background',
      publicUrl: image.url,
      localPath,
    };

    const existingAssets = await prisma.generatedAsset.findMany({
      where: { storyId: story.id, chapterId: chapter.id },
    });
    const characters = await prisma.character.findMany({
      where: { storyId: story.id },
      select: { name: true },
    });
    const assetRecords: VNGeneratedAssetRecord[] = [
      ...existingAssets.map(asset => ({
        assetId: asset.assetId,
        scopedAssetId: asset.scopedAssetId,
        category: asset.category,
        publicUrl: asset.publicUrl,
        localPath: asset.localPath,
      })),
      newAsset,
    ];

    const graphWithBackground = injectBackgroundAsset(chapter.graphJson as unknown as VNGraphSaveData, scopedAssetId);
    const validation = validateVNGraph(graphWithBackground, {
      requireEndingTerminal: true,
      knownSpeakers: characters.map(character => character.name).filter(Boolean),
      assetWhitelist: generatedAssetWhitelist(assetRecords),
      assetResolver: generatedAssetResolver(assetRecords),
    });
    if (!validation.valid) {
      return NextResponse.json({
        success: false,
        error: validation.error,
        warning: '图片已生成但未写入 VNGraph；请检查资产引用规则。',
        publicUrl: image.url,
      }, { status: 422 });
    }

    const asset = await prisma.$transaction(async tx => {
      const saved = await tx.generatedAsset.upsert({
        where: { storyId_scopedAssetId: { storyId: story.id, scopedAssetId } },
        create: {
          storyId: story.id,
          chapterId: chapter.id,
          assetId,
          scopedAssetId,
          category: 'Background',
          publicUrl: image.url,
          localPath,
          mimeType: guessMimeType(image.url),
          sha256: localPath ? hashFileIfExists(localPath) : null,
          prompt: image.prompt,
        },
        update: {
          chapterId: chapter.id,
          publicUrl: image.url,
          localPath,
          mimeType: guessMimeType(image.url),
          sha256: localPath ? hashFileIfExists(localPath) : null,
          prompt: image.prompt,
        },
      });
      await tx.generatedVNChapter.update({
        where: { id: chapter.id },
        data: { graphJson: graphWithBackground as any },
      });
      return saved;
    });

    return NextResponse.json({
      success: true,
      asset,
      graph: graphWithBackground,
      validation,
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

function publicUrlToLocalPath(publicUrl: string): string | null {
  if (!publicUrl.startsWith('/')) return null;
  return join(process.cwd(), 'public', publicUrl.replace(/^\/+/, ''));
}

function hashFileIfExists(path: string): string | null {
  if (!existsSync(path)) return null;
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function guessMimeType(publicUrl: string): string | null {
  if (/\.png($|\?)/i.test(publicUrl)) return 'image/png';
  if (/\.jpe?g($|\?)/i.test(publicUrl)) return 'image/jpeg';
  if (/\.webp($|\?)/i.test(publicUrl)) return 'image/webp';
  return null;
}

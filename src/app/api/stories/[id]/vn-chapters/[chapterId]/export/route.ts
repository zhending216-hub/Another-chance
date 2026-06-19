import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canViewStory } from '@/lib/permissions';
import { buildAIVNInstallablePackage } from '@/lib/vn/aivn-package';
import { buildVNExportPackage } from '@/lib/vn/export-package';

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

    const requestedFormat = request.nextUrl.searchParams.get('format');
    if (requestedFormat === 'aivn-folder' || requestedFormat === 'aivn-zip') {
      const format = requestedFormat === 'aivn-folder' ? 'folder' : 'zip';
      const exported = await buildAIVNInstallablePackage({
        storyId: params.id,
        chapterId: params.chapterId,
        format,
      });

      if (format === 'folder') {
        return NextResponse.json({
          success: true,
          format: requestedFormat,
          folderPath: exported.folderPath,
          packageId: exported.packageId,
          chapterAssetId: exported.chapterAssetId,
          manifest: exported.files[`Books/${exported.packageId}/manifest.json`],
          assetsManifest: exported.files['assets_manifest.json'],
          importReport: exported.files['import-report.json'],
          validation: exported.files['validation-report.json'],
        });
      }

      const filename = `aivn-installable-${params.chapterId}.zip`;
      return new NextResponse(exported.zipBuffer ? new Uint8Array(exported.zipBuffer) : null, {
        status: 200,
        headers: {
          'Content-Type': 'application/zip',
          'Content-Disposition': `attachment; filename="${filename}"`,
          'Cache-Control': 'no-store',
        },
      });
    }

    const format = requestedFormat === 'folder' ? 'folder' : 'zip';
    const exported = await buildVNExportPackage({
      storyId: params.id,
      chapterId: params.chapterId,
      format,
    });

    if (format === 'folder') {
      return NextResponse.json({
        success: true,
        format,
        folderPath: exported.folderPath,
        metadata: exported.files['metadata.json'],
        validation: exported.files['validation-report.json'],
        assetManifest: exported.files['asset-manifest.json'],
      });
    }

    const filename = `aivn-${params.chapterId}.zip`;
    return new NextResponse(exported.zipBuffer ? new Uint8Array(exported.zipBuffer) : null, {
      status: 200,
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${filename}"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('[vn-export] export failed:', error);
    return NextResponse.json({
      success: false,
      error: '导出 AIVN package 失败',
      details: error instanceof Error ? error.message : String(error),
    }, { status: 500 });
  }
}

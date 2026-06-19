import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { mkdtemp, readFile, rm, writeFile } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VNGraphSaveData } from '@/lib/vn/types';

const prismaMock = vi.hoisted(() => ({
  story: {
    findUnique: vi.fn(),
  },
  generatedVNChapter: {
    findFirst: vi.fn(),
  },
  generatedAsset: {
    findMany: vi.fn(),
  },
  character: {
    findMany: vi.fn(),
  },
}));

vi.mock('@/lib/prisma', () => ({ default: prismaMock }));

import { buildAIVNInstallablePackage } from '@/lib/vn/aivn-package';

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00]);

describe('AIVN package export with generated assets', () => {
  const cleanupPaths: string[] = [];

  afterEach(async () => {
    vi.clearAllMocks();
    for (const path of cleanupPaths.splice(0)) {
      await rm(path, { recursive: true, force: true });
    }
  });

  it('exports a background asset package that resolves used_assets and Objects bytes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gushi-aivn-assets-'));
    cleanupPaths.push(tempDir);
    const imagePath = join(tempDir, 'bg.demo.room.png');
    await writeFile(imagePath, PNG_BYTES);
    const imageHash = createHash('sha256').update(PNG_BYTES).digest('hex');

    prismaMock.story.findUnique.mockResolvedValue({
      id: 'story-assets',
      title: 'Asset Story',
      description: 'Story with a generated background.',
      genre: '原创',
      era: '',
      ownerId: 'user-1',
    });
    prismaMock.generatedVNChapter.findFirst.mockResolvedValue({
      id: 'chapter-assets',
      storyId: 'story-assets',
      branchId: 'main',
      sourceSegmentId: 'seg-1',
      graphJson: graphWithBackground(),
      status: 'valid',
      migrationRunId: 'run-assets',
      migrationKind: 'aivn-fused-generation-v1',
      sourceHash: 'source-hash',
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    });
    prismaMock.generatedAsset.findMany.mockResolvedValue([{
      assetId: 'bg.demo.room',
      scopedAssetId: 'assets:bg.demo.room',
      category: 'Background',
      publicUrl: '/generated-images/bg.demo.room.png',
      localPath: imagePath,
      mimeType: 'image/png',
      sha256: imageHash,
      prompt: 'rainy room',
      createdAt: new Date('2026-06-19T00:00:00.000Z'),
    }]);
    prismaMock.character.findMany.mockResolvedValue([]);

    const pkg = await buildAIVNInstallablePackage({
      storyId: 'story-assets',
      chapterId: 'chapter-assets',
      format: 'folder',
    });
    if (pkg.folderPath) cleanupPaths.push(pkg.folderPath);

    const bookManifest = pkg.files[`Books/${pkg.packageId}/manifest.json`] as any;
    const assetsManifest = pkg.files['assets_manifest.json'] as any;
    const validationReport = pkg.files['validation-report.json'] as any;
    const importReport = pkg.files['import-report.json'] as any;

    expect(bookManifest.entry_story).toBe(pkg.chapterAssetId);
    expect(bookManifest.used_assets).toEqual(['assets:bg.demo.room']);
    expect(assetsManifest.assets['bg.demo.room']).toMatchObject({
      type: 'image',
      category: 'background',
      ext: '.png',
      hash: `sha256-${imageHash}`,
    });
    expect(validationReport.valid).toBe(true);
    expect(importReport.copied_asset_count).toBe(1);
    expect(importReport.skipped_asset_count).toBe(0);

    const objectPath = join(pkg.folderPath!, 'Objects', `sha256_${imageHash}.png`);
    expect(existsSync(objectPath)).toBe(true);
    expect(await readFile(objectPath)).toEqual(PNG_BYTES);
    expect(existsSync(join(pkg.folderPath!, 'assets_manifest.json'))).toBe(true);
    expect(existsSync(join(pkg.folderPath!, 'Books', pkg.packageId, 'manifest.json'))).toBe(true);
  });
});

function graphWithBackground(): VNGraphSaveData {
  return {
    Version: 1,
    StartNodeIndex: 1,
    Nodes: [{
      Index: 1,
      DisplayName: '',
      Comment: '',
      NodeType: 1,
      SubType: 6,
      X: 0,
      Y: 0,
      Data: {
        BackgroundImage: { Kind: 'String', StringValue: 'assets:bg.demo.room' },
      },
      Outputs: { Next: [2] },
    }, {
      Index: 2,
      DisplayName: '',
      Comment: '',
      NodeType: 1,
      SubType: 11,
      X: 320,
      Y: 0,
      Data: {
        EndingId: { Kind: 'String', StringValue: '' },
        Title: { Kind: 'String', StringValue: '' },
        Subtitle: { Kind: 'String', StringValue: '' },
      },
      Outputs: {},
    }],
  };
}

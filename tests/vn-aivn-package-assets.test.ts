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

  it('exports visual action assets that resolve used_assets and Objects bytes', async () => {
    const tempDir = await mkdtemp(join(tmpdir(), 'gushi-aivn-assets-'));
    cleanupPaths.push(tempDir);
    const imagePath = join(tempDir, 'bg.demo.room.png');
    const tachiPath = join(tempDir, 'char.hero.png');
    const illustrationPath = join(tempDir, 'cg.reveal.png');
    const bgBytes = Buffer.concat([PNG_BYTES, Buffer.from([1])]);
    const tachiBytes = Buffer.concat([PNG_BYTES, Buffer.from([2])]);
    const illustrationBytes = Buffer.concat([PNG_BYTES, Buffer.from([3])]);
    await writeFile(imagePath, bgBytes);
    await writeFile(tachiPath, tachiBytes);
    await writeFile(illustrationPath, illustrationBytes);
    const imageHash = createHash('sha256').update(bgBytes).digest('hex');
    const tachiHash = createHash('sha256').update(tachiBytes).digest('hex');
    const illustrationHash = createHash('sha256').update(illustrationBytes).digest('hex');

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
      graphJson: graphWithVisualActions(),
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
    }, {
      assetId: 'char.hero',
      scopedAssetId: 'assets:char.hero',
      category: 'Tachi',
      publicUrl: '/generated-images/char.hero.png',
      localPath: tachiPath,
      mimeType: 'image/png',
      sha256: tachiHash,
      prompt: 'hero portrait',
      createdAt: new Date('2026-06-19T00:00:01.000Z'),
    }, {
      assetId: 'cg.reveal',
      scopedAssetId: 'assets:cg.reveal',
      category: 'Illustration',
      publicUrl: '/generated-images/cg.reveal.png',
      localPath: illustrationPath,
      mimeType: 'image/png',
      sha256: illustrationHash,
      prompt: 'reveal CG',
      createdAt: new Date('2026-06-19T00:00:02.000Z'),
    }]);
    prismaMock.character.findMany.mockResolvedValue([{ name: 'hero' }]);

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
    expect(bookManifest.used_assets).toEqual(['assets:bg.demo.room', 'assets:cg.reveal', 'assets:char.hero']);
    expect(assetsManifest.assets['bg.demo.room']).toMatchObject({
      type: 'image',
      category: 'background',
      ext: '.png',
      hash: `sha256-${imageHash}`,
    });
    expect(assetsManifest.assets['char.hero']).toMatchObject({
      type: 'image',
      category: 'tachi',
      ext: '.png',
      hash: `sha256-${tachiHash}`,
    });
    expect(assetsManifest.assets['cg.reveal']).toMatchObject({
      type: 'image',
      category: 'illustration',
      ext: '.png',
      hash: `sha256-${illustrationHash}`,
    });
    expect(validationReport.valid).toBe(true);
    expect(importReport.copied_asset_count).toBe(3);
    expect(importReport.skipped_asset_count).toBe(0);

    const objectPath = join(pkg.folderPath!, 'Objects', `sha256_${imageHash}.png`);
    const tachiObjectPath = join(pkg.folderPath!, 'Objects', `sha256_${tachiHash}.png`);
    const illustrationObjectPath = join(pkg.folderPath!, 'Objects', `sha256_${illustrationHash}.png`);
    expect(existsSync(objectPath)).toBe(true);
    expect(existsSync(tachiObjectPath)).toBe(true);
    expect(existsSync(illustrationObjectPath)).toBe(true);
    expect(await readFile(objectPath)).toEqual(bgBytes);
    expect(await readFile(tachiObjectPath)).toEqual(tachiBytes);
    expect(await readFile(illustrationObjectPath)).toEqual(illustrationBytes);
    expect(existsSync(join(pkg.folderPath!, 'assets_manifest.json'))).toBe(true);
    expect(existsSync(join(pkg.folderPath!, 'Books', pkg.packageId, 'manifest.json'))).toBe(true);
  });
});

function graphWithVisualActions(): VNGraphSaveData {
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
      SubType: 1,
      X: 320,
      Y: 0,
      Data: {
        SpeakerIdData: { Kind: 'String', StringValue: 'hero' },
        TextData: { Kind: 'String', StringValue: 'The reveal changed everything.' },
        VoiceIdData: { Kind: 'String', StringValue: '' },
      },
      Outputs: { Actions: [4], Next: [3] },
    }, {
      Index: 3,
      DisplayName: '',
      Comment: '',
      NodeType: 1,
      SubType: 11,
      X: 640,
      Y: 0,
      Data: {
        EndingId: { Kind: 'String', StringValue: '' },
        Title: { Kind: 'String', StringValue: '' },
        Subtitle: { Kind: 'String', StringValue: '' },
      },
      Outputs: {},
    }, {
      Index: 4,
      DisplayName: '',
      Comment: '',
      NodeType: 2,
      SubType: 7,
      X: 320,
      Y: 180,
      Data: {},
      Outputs: { Actions: [5, 6] },
    }, {
      Index: 5,
      DisplayName: '',
      Comment: '',
      NodeType: 2,
      SubType: 1,
      X: 80,
      Y: 180,
      Data: {
        TachiID: { Kind: 'String', StringValue: 'hero' },
        TachiIamge: { Kind: 'String', StringValue: 'assets:char.hero' },
        TargetPosition: { Kind: 'Vector2', X: 520, Y: 780 },
        EnterType: { Kind: 'Enum', StringValue: 'FadeIn' },
        Duration: { Kind: 'Float', NumberValue: 0.25 },
      },
      Outputs: {},
    }, {
      Index: 6,
      DisplayName: '',
      Comment: '',
      NodeType: 2,
      SubType: 6,
      X: 80,
      Y: 280,
      Data: {
        IllustrationImage: { Kind: 'String', StringValue: 'assets:cg.reveal' },
        ChangeType: { Kind: 'Enum', StringValue: 'FadeIn' },
        Duration: { Kind: 'Float', NumberValue: 0.45 },
        PerformanceType: { Kind: 'Enum', StringValue: 'None' },
        FocusPoint: { Kind: 'Vector2', X: 0.5, Y: 0.5 },
        FocusScale: { Kind: 'Float', NumberValue: 1.4 },
        FocusHoldDuration: { Kind: 'Float', NumberValue: 0.1 },
        HideDialogueDuringPerformance: { Kind: 'Bool', BoolValue: false },
      },
      Outputs: {},
    }],
  };
}

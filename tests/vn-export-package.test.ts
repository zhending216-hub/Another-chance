import { describe, expect, it } from 'vitest';
import { buildAssetManifest } from '@/lib/vn/export-package';

describe('VN export package helpers', () => {
  it('maps generated assets into package manifest entries', () => {
    const manifest = buildAssetManifest([{
      assetId: 'bg.demo.room',
      scopedAssetId: 'assets:bg.demo.room',
      category: 'Background',
      publicUrl: '/generated-images/demo.png',
      localPath: '/app/public/generated-images/demo.png',
      mimeType: 'image/png',
      sha256: 'abc123',
      prompt: 'cinematic room',
    }]);

    expect(manifest).toEqual([{
      assetId: 'bg.demo.room',
      scopedAssetId: 'assets:bg.demo.room',
      category: 'Background',
      publicUrl: '/generated-images/demo.png',
      localPath: '/app/public/generated-images/demo.png',
      packagePath: 'assets/demo.png',
      mimeType: 'image/png',
      sha256: 'abc123',
      prompt: 'cinematic room',
    }]);
  });

  it('allows text-only chapters with no asset package paths', () => {
    expect(buildAssetManifest([])).toEqual([]);
  });
});

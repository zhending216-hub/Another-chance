import type { VNAssetResolver, VNAssetWhitelist, VNGraphSaveData, VNSerializedValue } from './types';

export interface VNGeneratedAssetRecord {
  assetId: string;
  scopedAssetId: string;
  category: string;
  publicUrl: string;
  localPath?: string | null;
}

export type VNAssetCategory = 'Background' | 'Tachi' | 'Illustration';

const CATEGORY_PREFIX: Record<VNAssetCategory, string> = {
  Background: 'bg',
  Tachi: 'char',
  Illustration: 'cg',
};

export function buildAIVNAssetIds(options: {
  storyTitle: string;
  chapterId: string;
  category: VNAssetCategory;
  index?: number;
}) {
  const prefix = CATEGORY_PREFIX[options.category];
  const storySlug = slugify(options.storyTitle || 'story');
  const chapterSlug = slugify(options.chapterId).slice(0, 16) || 'chapter';
  const index = Math.max(0, options.index ?? 0);
  const assetId = `${prefix}.${storySlug}.${chapterSlug}.${index}`;
  return { assetId, scopedAssetId: `assets:${assetId}` };
}

export function injectBackgroundAsset(
  graph: VNGraphSaveData,
  scopedAssetId: string,
): VNGraphSaveData {
  const next = JSON.parse(JSON.stringify(graph)) as VNGraphSaveData;
  const start = next.Nodes.find(node => Number(node.NodeType) === 1 && node.SubType === 6);
  if (!start) return next;
  start.Data = {
    ...start.Data,
    BackgroundImage: { Kind: 'String', StringValue: scopedAssetId },
  };
  return next;
}

export function collectScopedAssetIds(graph: VNGraphSaveData): string[] {
  const result = new Set<string>();
  for (const node of graph.Nodes ?? []) {
    collectFromUnknown(node.Data, result);
  }
  return [...result];
}

export function generatedAssetWhitelist(assets: VNGeneratedAssetRecord[]): VNAssetWhitelist {
  const byCategory = new Map<string, Set<string>>();
  for (const asset of assets) {
    const key = asset.category.toLowerCase();
    const bucket = byCategory.get(key) ?? new Set<string>();
    bucket.add(asset.scopedAssetId);
    byCategory.set(key, bucket);
  }
  return {
    contains(category: string, scopedAssetId: string) {
      return byCategory.get(category.toLowerCase())?.has(scopedAssetId) ?? false;
    },
  };
}

export function generatedAssetResolver(assets: VNGeneratedAssetRecord[]): VNAssetResolver {
  const byScopedId = new Map(assets.map(asset => [asset.scopedAssetId, asset]));
  return {
    resolve(scopedAssetId: string) {
      const asset = byScopedId.get(scopedAssetId);
      if (!asset) return false;
      return asset.localPath || asset.publicUrl || false;
    },
  };
}

function collectFromUnknown(value: unknown, result: Set<string>) {
  if (!value || typeof value !== 'object') return;
  const maybeValue = value as VNSerializedValue;
  if (maybeValue.Kind === 'String' && maybeValue.StringValue?.startsWith('assets:')) {
    result.add(maybeValue.StringValue);
    return;
  }
  if (Array.isArray(maybeValue.Items)) {
    for (const item of maybeValue.Items) collectFromUnknown(item, result);
  }
  if (maybeValue.ObjectValue && typeof maybeValue.ObjectValue === 'object') {
    for (const child of Object.values(maybeValue.ObjectValue)) collectFromUnknown(child, result);
  }
  for (const child of Object.values(value as Record<string, unknown>)) {
    collectFromUnknown(child, result);
  }
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '')
    .slice(0, 32);
  return slug || 'item';
}

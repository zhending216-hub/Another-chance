import { createHash } from 'crypto';
import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import {
  generateImagesForSegment,
  type GeneratedImage,
  type GenerateImagesOptions,
  type ImageStyle,
} from '@/lib/image-generator';
import {
  buildAIVNAssetIds,
  generatedAssetResolver,
  generatedAssetWhitelist,
  injectBackgroundAsset,
  type VNAssetCategory,
  type VNGeneratedAssetRecord,
} from './asset-bridge';
import type { VNGraphSaveData, VNGraphValidationResult } from './types';
import { validateVNGraph } from './validator';

export type AIVNChapterAssetCategory = VNAssetCategory;

export interface AIVNGeneratedAssetPreview extends VNGeneratedAssetRecord {
  mimeType: string;
  sha256: string;
  prompt: string;
}

export interface AIVNImageValidationResult {
  valid: boolean;
  extension: '.png' | '.jpg' | '.webp' | '';
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp' | '';
  sha256: string;
  error: string;
}

export interface AIVNChapterAssetPreviewSuccess {
  success: true;
  category: AIVNChapterAssetCategory;
  asset: AIVNGeneratedAssetPreview;
  image: GeneratedImage;
  graph: VNGraphSaveData;
  graphChanged: boolean;
  validation: VNGraphValidationResult;
  warning: string;
}

export interface AIVNChapterAssetPreviewFailure {
  success: false;
  category: AIVNChapterAssetCategory;
  graph: VNGraphSaveData;
  graphChanged: false;
  warning: string;
  error: string;
  image?: GeneratedImage;
  validation?: VNGraphValidationResult;
}

export type AIVNChapterAssetPreviewResult =
  | AIVNChapterAssetPreviewSuccess
  | AIVNChapterAssetPreviewFailure;

export type GenerateImagesForSegmentFn = (options: GenerateImagesOptions) => Promise<GeneratedImage[]>;

export type AIVNImageFileLoader = (publicUrl: string) => Promise<{
  localPath: string | null;
  bytes: Buffer | null;
  error?: string;
}>;

export interface GenerateAIVNChapterAssetPreviewOptions {
  storyTitle: string;
  chapterId: string;
  graph: VNGraphSaveData;
  category: AIVNChapterAssetCategory;
  segmentId: string;
  segmentContent: string;
  style?: ImageStyle;
  genre?: string;
  storyDescription?: string;
  callAIFn?: (prompt: string) => Promise<string>;
  existingAssets?: VNGeneratedAssetRecord[];
  knownSpeakers?: string[];
  index?: number;
  generateImages?: GenerateImagesForSegmentFn;
  loadImageFile?: AIVNImageFileLoader;
}

export async function generateAIVNChapterAssetPreview(
  options: GenerateAIVNChapterAssetPreviewOptions,
): Promise<AIVNChapterAssetPreviewResult> {
  const imageGenerator = options.generateImages ?? generateImagesForSegment;
  const imageLoader = options.loadImageFile ?? loadGeneratedImageFile;
  const images = await imageGenerator({
    segmentId: options.segmentId,
    segmentContent: options.segmentContent,
    style: options.style || 'auto',
    maxImages: 1,
    genre: options.genre,
    storyDescription: options.storyDescription,
    callAIFn: options.callAIFn,
  });

  if (images.length === 0) {
    return nonBlockingFailure(options, 'image_generation_empty', '图片生成未返回结果，VNGraph 保持 text-only。');
  }

  const image = images[0];
  const loaded = await imageLoader(image.url);
  if (!loaded.bytes) {
    return nonBlockingFailure(
      options,
      'image_file_missing',
      loaded.error || '图片生成结果没有可校验的本地文件，VNGraph 保持 text-only。',
      image,
    );
  }

  const bytesValidation = validateAIVNImageBytes(loaded.bytes);
  if (!bytesValidation.valid) {
    return nonBlockingFailure(
      options,
      'image_bytes_invalid',
      `${bytesValidation.error} VNGraph 保持 text-only。`,
      image,
    );
  }

  const { assetId, scopedAssetId } = buildAIVNAssetIds({
    storyTitle: options.storyTitle,
    chapterId: options.chapterId,
    category: options.category,
    index: options.index ?? 0,
  });
  const asset: AIVNGeneratedAssetPreview = {
    assetId,
    scopedAssetId,
    category: options.category,
    publicUrl: image.url,
    localPath: loaded.localPath,
    mimeType: bytesValidation.mimeType,
    sha256: bytesValidation.sha256,
    prompt: image.prompt,
  };

  const graph = injectAssetIntoGraph(options.graph, options.category, scopedAssetId);
  const graphChanged = graph !== options.graph;
  const assetRecords = [...(options.existingAssets ?? []), asset];
  const validation = validateVNGraph(graph, {
    requireEndingTerminal: true,
    knownSpeakers: options.knownSpeakers ?? [],
    assetWhitelist: generatedAssetWhitelist(assetRecords),
    assetResolver: generatedAssetResolver(assetRecords),
  });
  if (!validation.valid) {
    return {
      success: false,
      category: options.category,
      graph: options.graph,
      graphChanged: false,
      image,
      validation,
      error: validation.error,
      warning: '图片已生成并通过字节校验，但未写入 VNGraph；请检查资产引用规则。',
    };
  }

  return {
    success: true,
    category: options.category,
    asset,
    image,
    graph,
    graphChanged,
    validation,
    warning: graphChanged
      ? ''
      : `${options.category} asset generated but graph placement was not changed; package export can still include the asset.`,
  };
}

export function validateAIVNImageBytes(bytes: Buffer | Uint8Array | null | undefined): AIVNImageValidationResult {
  const empty: AIVNImageValidationResult = {
    valid: false,
    extension: '',
    mimeType: '',
    sha256: '',
    error: '',
  };

  if (!bytes || bytes.length === 0) {
    return { ...empty, error: 'AI image provider returned empty image bytes.' };
  }

  if (looksLikeHtml(bytes)) {
    return { ...empty, error: 'AI image provider returned HTML instead of an image.' };
  }

  const buffer = Buffer.from(bytes);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  if (isPng(buffer)) {
    return { valid: true, extension: '.png', mimeType: 'image/png', sha256, error: '' };
  }
  if (isJpeg(buffer)) {
    return { valid: true, extension: '.jpg', mimeType: 'image/jpeg', sha256, error: '' };
  }
  if (isWebp(buffer)) {
    return { valid: true, extension: '.webp', mimeType: 'image/webp', sha256, error: '' };
  }

  return {
    ...empty,
    error: 'AI image provider returned unsupported image bytes. Expected PNG, JPEG, or WebP.',
  };
}

export async function loadGeneratedImageFile(publicUrl: string): Promise<{
  localPath: string | null;
  bytes: Buffer | null;
  error?: string;
}> {
  const localPath = publicUrlToLocalPath(publicUrl);
  if (!localPath) {
    return { localPath: null, bytes: null, error: 'Generated image URL is not a local public asset.' };
  }
  if (!existsSync(localPath)) {
    return { localPath, bytes: null, error: 'Generated image local file is missing.' };
  }
  return { localPath, bytes: await readFile(localPath) };
}

export function publicUrlToLocalPath(publicUrl: string): string | null {
  if (!publicUrl.startsWith('/')) return null;
  return join(process.cwd(), 'public', publicUrl.replace(/^\/+/, ''));
}

function injectAssetIntoGraph(
  graph: VNGraphSaveData,
  category: AIVNChapterAssetCategory,
  scopedAssetId: string,
): VNGraphSaveData {
  if (category === 'Background') return injectBackgroundAsset(graph, scopedAssetId);
  return graph;
}

function nonBlockingFailure(
  options: GenerateAIVNChapterAssetPreviewOptions,
  error: string,
  warning: string,
  image?: GeneratedImage,
): AIVNChapterAssetPreviewFailure {
  return {
    success: false,
    category: options.category,
    graph: options.graph,
    graphChanged: false,
    warning,
    error,
    image,
  };
}

function isPng(bytes: Buffer | Uint8Array): boolean {
  return bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4E &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0D &&
    bytes[5] === 0x0A &&
    bytes[6] === 0x1A &&
    bytes[7] === 0x0A;
}

function isJpeg(bytes: Buffer | Uint8Array): boolean {
  return bytes.length >= 3 &&
    bytes[0] === 0xFF &&
    bytes[1] === 0xD8 &&
    bytes[2] === 0xFF;
}

function isWebp(bytes: Buffer | Uint8Array): boolean {
  return bytes.length >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;
}

function looksLikeHtml(bytes: Buffer | Uint8Array): boolean {
  const prefix = Buffer.from(bytes.slice(0, Math.min(bytes.length, 64)))
    .toString('utf8')
    .trimStart()
    .toLowerCase();
  return prefix.startsWith('<html') || prefix.startsWith('<!doctype html') || prefix.startsWith('<svg');
}

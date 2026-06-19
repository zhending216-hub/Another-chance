import prisma from '@/lib/prisma';
import { getOrderedChain } from '@/lib/chain-helpers';
import { directorManager } from '@/lib/director-manager';
import {
  addAssetToWhitelist,
  createAssetWhitelist,
  type GenerationAssetCategory,
  type GenerationAssetReference,
  type GenerationContext,
  type GenerationForkContext,
  type GenerationMode,
  type GenerationVisualState,
} from '@/lib/generation/contracts';

export interface VNContextStory {
  id: string;
  title: string;
  description: string;
  genre: string;
  era: string;
}

export interface VNContextSegment {
  id: string;
  title: string;
  content: string;
  parentSegmentId: string | null;
  imageUrls: string[];
  characterIds: string[];
}

export interface VNContextBranch {
  id: string;
  title: string;
  userDirection: string;
  sourceSegmentId: string;
}

export interface VNContextCharacter {
  id: string;
  name: string;
  canonicalName: string;
  role: string;
  speechPatterns: string;
  appearance: string;
}

export interface VNContextEvent {
  id: string;
  eventType: string;
  description: string;
  importance: string;
  status: string;
}

export interface VNGenerationContext {
  story: VNContextStory;
  branchId: string;
  sourceSegmentId: string | null;
  chain: VNContextSegment[];
  branch: VNContextBranch | null;
  characters: VNContextCharacter[];
  directorState: Record<string, unknown> | null;
  summaries: string[];
  events: VNContextEvent[];
  knownSpeakers: string[];
}

export interface BuildVNGenerationContextOptions {
  storyId: string;
  branchId?: string;
  sourceSegmentId?: string;
  maxChainSegments?: number;
}

export interface BuildAIVNGenerationContextOptions extends BuildVNGenerationContextOptions {
  mode?: GenerationMode;
  fork?: GenerationForkContext | null;
  visualState?: GenerationVisualState | null;
  generatedAssets?: GenerationAssetReference[];
  includeGeneratedAssets?: boolean;
  chapterId?: string;
}

export interface AIVNGenerationContextAdapterOptions {
  mode?: GenerationMode;
  fork?: GenerationForkContext | null;
  visualState?: GenerationVisualState | null;
  generatedAssets?: GenerationAssetReference[];
}

export async function buildVNGenerationContext(
  options: BuildVNGenerationContextOptions,
): Promise<VNGenerationContext> {
  const branchId = options.branchId || 'main';
  const story = await prisma.story.findUnique({ where: { id: options.storyId } });
  if (!story) throw new Error('Story not found.');

  const rawChain = await getOrderedChain(options.storyId, branchId);
  let chain = rawChain;
  if (options.sourceSegmentId) {
    const index = rawChain.findIndex(segment => segment.id === options.sourceSegmentId);
    if (index >= 0) chain = rawChain.slice(0, index + 1);
  }
  if (options.maxChainSegments && options.maxChainSegments > 0) {
    chain = chain.slice(-options.maxChainSegments);
  }
  if (chain.length === 0) throw new Error('Branch has no segments.');

  const branch = branchId === 'main'
    ? null
    : await prisma.storyBranch.findUnique({ where: { id: branchId } });

  const [characters, directorState, summaries, events] = await Promise.all([
    prisma.character.findMany({
      where: { storyId: options.storyId },
      orderBy: { createdAt: 'asc' },
    }),
    directorManager.getState(options.storyId).catch(() => null),
    prisma.segmentSummary.findMany({
      where: { storyId: options.storyId, branchId },
      orderBy: { chainIndex: 'asc' },
      take: 12,
    }).catch(() => []),
    prisma.keyEvent.findMany({
      where: { storyId: options.storyId, branchId, status: 'active' },
      orderBy: { updatedAt: 'desc' },
      take: 12,
    }).catch(() => []),
  ]);

  const knownSpeakers = characters
    .map(character => character.name)
    .filter((name): name is string => !!name && name.trim().length > 0);

  return {
    story: {
      id: story.id,
      title: story.title,
      description: story.description ?? '',
      genre: story.genre ?? '',
      era: story.era ?? '',
    },
    branchId,
    sourceSegmentId: options.sourceSegmentId ?? chain[chain.length - 1]?.id ?? null,
    chain: chain.map(segment => ({
      id: segment.id,
      title: segment.title ?? '',
      content: segment.content,
      parentSegmentId: segment.parentSegmentId ?? null,
      imageUrls: segment.imageUrls ?? [],
      characterIds: segment.characterIds ?? [],
    })),
    branch: branch ? {
      id: branch.id,
      title: branch.title,
      userDirection: branch.userDirection,
      sourceSegmentId: branch.sourceSegmentId,
    } : null,
    characters: characters.map(character => ({
      id: character.id,
      name: character.name,
      canonicalName: character.canonicalName ?? '',
      role: character.role ?? '',
      speechPatterns: character.speechPatterns ?? '',
      appearance: character.appearance ?? '',
    })),
    directorState: directorState ? {
      characterStates: directorState.characterStates,
      worldVariables: directorState.worldVariables,
      activeConstraints: directorState.activeConstraints,
    } : null,
    summaries: summaries.map(summary => summary.summary).filter(Boolean),
    events: events.map(event => ({
      id: event.id,
      eventType: event.eventType,
      description: event.description,
      importance: event.importance,
      status: event.status,
    })),
    knownSpeakers,
  };
}

export async function buildAIVNGenerationContext(
  options: BuildAIVNGenerationContextOptions,
): Promise<GenerationContext> {
  const context = await buildVNGenerationContext(options);
  const persistedAssets = options.includeGeneratedAssets === false
    ? []
    : await prisma.generatedAsset.findMany({
      where: {
        storyId: options.storyId,
        ...(options.chapterId ? { chapterId: options.chapterId } : {}),
      },
      orderBy: { createdAt: 'asc' },
    }).catch(() => []);

  const persistedAssetReferences: GenerationAssetReference[] = [];
  for (const asset of persistedAssets) {
    const category = normalizeAssetCategory(asset.category);
    if (!category) continue;
    persistedAssetReferences.push({
      category,
      assetId: asset.assetId,
      scopedAssetId: asset.scopedAssetId,
      sourceHash: asset.sha256 ?? undefined,
      publicUrl: asset.publicUrl,
      localPath: asset.localPath ?? undefined,
      contentType: asset.mimeType ?? undefined,
    });
  }

  const generatedAssets: GenerationAssetReference[] = [
    ...persistedAssetReferences,
    ...(options.generatedAssets ?? []),
  ];

  return toAIVNGenerationContext(context, {
    mode: options.mode,
    fork: options.fork,
    visualState: options.visualState,
    generatedAssets,
  });
}

export function toAIVNGenerationContext(
  context: VNGenerationContext,
  options: AIVNGenerationContextAdapterOptions = {},
): GenerationContext {
  const fork = options.fork ?? null;
  const visualState = mergeVisualState(options.visualState ?? null, fork);
  const assetWhitelist = createAssetWhitelist(options.generatedAssets ?? []);
  addVisualStateAssetsToWhitelist(assetWhitelist, visualState);

  return {
    mode: options.mode ?? 'vnGraphPreview',
    story: {
      id: context.story.id,
      title: context.story.title,
      description: context.story.description,
      genre: context.story.genre,
      era: context.story.era,
    },
    branchId: context.branchId,
    sourceSegmentId: context.sourceSegmentId ?? undefined,
    chain: context.chain.map(segment => ({
      id: segment.id,
      title: segment.title,
      content: segment.content,
      parentSegmentId: segment.parentSegmentId,
      imageUrls: segment.imageUrls,
      characterIds: segment.characterIds,
    })),
    branch: context.branch ? {
      id: context.branch.id,
      title: context.branch.title,
      userDirection: context.branch.userDirection,
      sourceSegmentId: context.branch.sourceSegmentId,
    } : null,
    fork,
    characters: buildGenerationCharacterTable(context),
    summaries: context.summaries,
    events: context.events.map(event => ({
      id: event.id,
      description: event.description,
      importance: event.importance,
      status: event.status,
    })),
    directorState: context.directorState,
    assetWhitelist,
    visualState,
  };
}

function buildGenerationCharacterTable(context: VNGenerationContext) {
  const exactSpeakerIds = uniqueStrings(context.knownSpeakers);
  const aliasesBySpeakerId: Record<string, string[]> = {};
  const entries = context.characters.map(character => {
    const speakerId = character.name.trim() || character.id;
    const aliases = uniqueStrings([
      character.id,
      character.canonicalName,
      character.canonicalName && character.canonicalName !== speakerId ? character.canonicalName : '',
    ]).filter(alias => alias !== speakerId);
    if (aliases.length > 0) aliasesBySpeakerId[speakerId] = aliases;

    return {
      id: speakerId,
      displayName: character.name,
      canonicalName: character.canonicalName || undefined,
      aliases,
      role: character.role || undefined,
      speechPatterns: character.speechPatterns || undefined,
      appearance: character.appearance || undefined,
      voiceCard: buildVoiceCard(character),
    };
  });

  return {
    entries,
    exactSpeakerIds,
    aliasesBySpeakerId,
  };
}

function buildVoiceCard(character: VNContextCharacter): string | undefined {
  const parts = [
    character.role ? `role=${character.role}` : '',
    character.speechPatterns ? `speech=${character.speechPatterns}` : '',
  ].filter(Boolean);
  return parts.length > 0 ? parts.join('; ') : undefined;
}

function mergeVisualState(
  explicit: GenerationVisualState | null,
  fork: GenerationForkContext | null,
): GenerationVisualState | undefined {
  const backgroundAssetId = explicit?.backgroundAssetId || fork?.currentBackgroundImage || '';
  const illustrationAssetId = explicit?.illustrationAssetId || fork?.currentIllustrationImage || '';
  const tachiAssetIds = uniqueStrings([
    ...(explicit?.tachiAssetIds ?? []),
    ...(fork?.tachis ?? []).map(tachi => tachi.image),
  ]);

  const result: GenerationVisualState = {};
  if (backgroundAssetId) result.backgroundAssetId = backgroundAssetId;
  if (illustrationAssetId) result.illustrationAssetId = illustrationAssetId;
  if (tachiAssetIds.length > 0) result.tachiAssetIds = tachiAssetIds;
  return Object.keys(result).length > 0 ? result : undefined;
}

function addVisualStateAssetsToWhitelist(
  whitelist: ReturnType<typeof createAssetWhitelist>,
  visualState: GenerationVisualState | undefined,
) {
  if (!visualState) return;
  const candidates = [
    visualState.backgroundAssetId,
    visualState.illustrationAssetId,
    ...(visualState.tachiAssetIds ?? []),
  ];
  for (const scopedAssetId of candidates) {
    if (!scopedAssetId) continue;
    const category = inferAssetCategory(scopedAssetId);
    if (category) addAssetToWhitelist(whitelist, category, scopedAssetId);
  }
}

function inferAssetCategory(scopedAssetId: string): GenerationAssetCategory | null {
  const value = scopedAssetId.trim().toLowerCase();
  if (value.startsWith('assets:bg.')) return 'Background';
  if (value.startsWith('assets:char.')) return 'Tachi';
  if (value.startsWith('assets:cg.')) return 'Illustration';
  return null;
}

function normalizeAssetCategory(category: string): GenerationAssetCategory | null {
  const value = category.trim().toLowerCase();
  if (value === 'background') return 'Background';
  if (value === 'tachi') return 'Tachi';
  if (value === 'illustration') return 'Illustration';
  if (value === 'voice') return 'Voice';
  if (value === 'bgm') return 'Bgm';
  if (value === 'soundeffect' || value === 'sound_effect') return 'SoundEffect';
  return null;
}

function uniqueStrings(values: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const normalized = (value ?? '').trim();
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(normalized);
  }
  return result;
}

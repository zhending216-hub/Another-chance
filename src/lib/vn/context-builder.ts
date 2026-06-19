import prisma from '@/lib/prisma';
import { getOrderedChain } from '@/lib/chain-helpers';
import { directorManager } from '@/lib/director-manager';

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

import prisma from '@/lib/prisma';
import type { Story, StoryBranch, StorySegment } from '@/lib/prisma';
import type { VNGraphSaveData, VNNodeSaveData, VNSerializedValue } from './types';
import { validateVNGraph } from './validator';

export interface StoryTreeMigrationInput {
  story: Story;
  segments: StorySegment[];
  branches: StoryBranch[];
}

export interface StoryTreeMigrationResult {
  storyId: string;
  graph: VNGraphSaveData;
  validation: ReturnType<typeof validateVNGraph>;
  segmentCount: number;
  branchCount: number;
}

export async function selectSampleStoryForVNMigration(storyId?: string): Promise<StoryTreeMigrationInput> {
  const story = storyId
    ? await prisma.story.findUnique({ where: { id: storyId } })
    : await findSmallSampleStory();
  if (!story) throw new Error(storyId ? `Story not found: ${storyId}` : 'No story found for sample migration.');

  const [segments, branches] = await Promise.all([
    prisma.storySegment.findMany({ where: { storyId: story.id }, orderBy: { createdAt: 'asc' } }),
    prisma.storyBranch.findMany({ where: { storyId: story.id }, orderBy: { createdAt: 'asc' } }),
  ]);
  if (segments.length === 0) throw new Error(`Story has no segments: ${story.id}`);
  return { story, segments, branches };
}

export function convertStoryTreeToVNGraph(input: StoryTreeMigrationInput): StoryTreeMigrationResult {
  const mainSegments = orderedChain(input.segments.filter(segment => segment.branchId === 'main'));
  const branchSegmentsByBranchId = new Map<string, StorySegment[]>();
  for (const branch of input.branches) {
    branchSegmentsByBranchId.set(
      branch.id,
      orderedBranchChain(input.segments.filter(segment => segment.branchId === branch.id), branch.sourceSegmentId),
    );
  }

  const nodes: VNNodeSaveData[] = [];
  let nextIndex = 1;
  const startIndex = nextIndex++;
  nodes.push(startNode(startIndex));

  const segmentNodeIndexes = new Map<string, number>();
  const mainNodeIndexes: number[] = [];
  for (const segment of mainSegments) {
    const index = nextIndex++;
    segmentNodeIndexes.set(segment.id, index);
    mainNodeIndexes.push(index);
    nodes.push(paragraphNode(index, segment.content, 260 + nodes.length * 220, 120));
  }

  const branchFirstIndexes = new Map<string, number>();
  const branchLastIndexes = new Map<string, number>();
  for (const branch of input.branches) {
    const branchChain = branchSegmentsByBranchId.get(branch.id) ?? [];
    for (const segment of branchChain) {
      const index = nextIndex++;
      segmentNodeIndexes.set(segment.id, index);
      if (!branchFirstIndexes.has(branch.id)) branchFirstIndexes.set(branch.id, index);
      branchLastIndexes.set(branch.id, index);
      nodes.push(paragraphNode(index, segment.content, 260 + nodes.length * 220, 360));
    }
  }

  const endIndex = nextIndex++;
  nodes.push(endNode(endIndex, 260 + nodes.length * 220, 120));

  const nodeByIndex = new Map(nodes.map(node => [node.Index, node]));
  const branchesBySource = groupBranchesBySource(input.branches);

  if (mainNodeIndexes.length === 0) {
    nodeByIndex.get(startIndex)!.Outputs.Next = [endIndex];
  } else {
    nodeByIndex.get(startIndex)!.Outputs.Next = [mainNodeIndexes[0]];
  }

  for (let i = 0; i < mainSegments.length; i++) {
    const segment = mainSegments[i];
    const node = nodeByIndex.get(mainNodeIndexes[i])!;
    const nextMainIndex = mainNodeIndexes[i + 1] ?? endIndex;
    const sourceBranches = branchesBySource.get(segment.id) ?? [];
    const availableBranches = sourceBranches.filter(branch => branchFirstIndexes.has(branch.id));

    if (availableBranches.length > 0) {
      const choiceIndex = nextIndex++;
      const options = availableBranches.map(branch => optionObject(branch.userDirection || branch.title));
      options.push(optionObject('继续主线'));
      const choice = choiceNode(choiceIndex, options, node.X + 180, node.Y + 140);
      nodes.push(choice);
      node.Outputs.Next = [choiceIndex];

      availableBranches.forEach((branch, optionIndex) => {
        choice.Outputs[`Options[${optionIndex}].Next`] = [branchFirstIndexes.get(branch.id)!];
      });
      choice.Outputs[`Options[${availableBranches.length}].Next`] = [nextMainIndex];
    } else {
      node.Outputs.Next = [nextMainIndex];
    }
  }

  for (const branch of input.branches) {
    const branchChain = branchSegmentsByBranchId.get(branch.id) ?? [];
    for (let i = 0; i < branchChain.length; i++) {
      const current = nodeByIndex.get(segmentNodeIndexes.get(branchChain[i].id)!)!;
      const next = branchChain[i + 1] ? segmentNodeIndexes.get(branchChain[i + 1].id)! : endIndex;
      current.Outputs.Next = [next];
    }
  }

  const graph: VNGraphSaveData = {
    Version: 1,
    StartNodeIndex: startIndex,
    Nodes: nodes,
  };
  const validation = validateVNGraph(graph, { requireEndingTerminal: true });
  return {
    storyId: input.story.id,
    graph,
    validation,
    segmentCount: input.segments.length,
    branchCount: input.branches.length,
  };
}

async function findSmallSampleStory(): Promise<Story | null> {
  const stories = await prisma.story.findMany({ orderBy: { createdAt: 'asc' }, take: 100 });
  let best: { story: Story; segmentCount: number; branchCount: number } | null = null;
  for (const story of stories) {
    const [segmentCount, branchCount] = await Promise.all([
      prisma.storySegment.count({ where: { storyId: story.id } }),
      prisma.storyBranch.count({ where: { storyId: story.id } }),
    ]);
    if (segmentCount === 0) continue;
    const candidate = { story, segmentCount, branchCount };
    if (!best) {
      best = candidate;
      continue;
    }
    const candidateScore = (branchCount > 0 ? 0 : 1000) + segmentCount + branchCount * 2;
    const bestScore = (best.branchCount > 0 ? 0 : 1000) + best.segmentCount + best.branchCount * 2;
    if (candidateScore < bestScore) best = candidate;
  }
  return best?.story ?? null;
}

function orderedChain(segments: StorySegment[]): StorySegment[] {
  const chain: StorySegment[] = [];
  let current: StorySegment | undefined = segments.find(segment => !segment.parentSegmentId);
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current);
    current = segments.find(segment => segment.parentSegmentId === current!.id);
  }
  return chain.length > 0 ? chain : segments;
}

function orderedBranchChain(segments: StorySegment[], sourceSegmentId: string): StorySegment[] {
  const chain: StorySegment[] = [];
  let current: StorySegment | undefined = segments.find(segment => segment.parentSegmentId === sourceSegmentId) ?? segments[0];
  const visited = new Set<string>();
  while (current && !visited.has(current.id)) {
    visited.add(current.id);
    chain.push(current);
    current = segments.find(segment => segment.parentSegmentId === current!.id);
  }
  return chain;
}

function groupBranchesBySource(branches: StoryBranch[]): Map<string, StoryBranch[]> {
  const grouped = new Map<string, StoryBranch[]>();
  for (const branch of branches) {
    const list = grouped.get(branch.sourceSegmentId) ?? [];
    list.push(branch);
    grouped.set(branch.sourceSegmentId, list);
  }
  return grouped;
}

function startNode(index: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: 'Start',
    Comment: '',
    NodeType: 1,
    SubType: 6,
    X: 80,
    Y: 120,
    Data: {},
    Outputs: { Next: [] },
  };
}

function paragraphNode(index: number, text: string, x: number, y: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: 1,
    SubType: 2,
    X: x,
    Y: y,
    Data: {
      Lines: listValue([objectValue({
        SpeakerId: stringValue(''),
        Text: stringValue(text),
        VoiceId: stringValue(''),
      })]),
    },
    Outputs: { Actions: [], Next: [] },
  };
}

function choiceNode(index: number, options: VNSerializedValue[], x: number, y: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: 1,
    SubType: 5,
    X: x,
    Y: y,
    Data: { Options: listValue(options) },
    Outputs: {},
  };
}

function optionObject(text: string): VNSerializedValue {
  return objectValue({ Text: stringValue(text || '继续') });
}

function endNode(index: number, x: number, y: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: 'End',
    Comment: '',
    NodeType: 1,
    SubType: 11,
    X: x,
    Y: y,
    Data: {
      EndingId: stringValue(''),
      Title: stringValue(''),
      Subtitle: stringValue(''),
    },
    Outputs: {},
  };
}

function stringValue(value: string): VNSerializedValue {
  return { Kind: 'String', StringValue: value };
}

function listValue(items: VNSerializedValue[]): VNSerializedValue {
  return { Kind: 'List', Items: items };
}

function objectValue(value: Record<string, VNSerializedValue>): VNSerializedValue {
  return { Kind: 'Object', ObjectValue: value };
}

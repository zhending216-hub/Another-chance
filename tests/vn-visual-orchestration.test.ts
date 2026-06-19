import { describe, expect, it } from 'vitest';
import { orchestrateVNGraphVisuals } from '@/lib/vn/visual-orchestration';
import type { VNGeneratedAssetRecord } from '@/lib/vn/asset-bridge';
import type { VNGraphSaveData, VNNodeSaveData, VNSerializedValue } from '@/lib/vn/types';

const Progress = 1;
const Action = 2;

describe('AIVN visual orchestration', () => {
  it('places speaker-aware Tachi and selective Illustration actions with clear state', () => {
    const result = orchestrateVNGraphVisuals({
      graph: graphFixture(),
      assets: visualAssets(),
      knownSpeakers: ['hero', 'rival'],
    });

    expect(result.validation.valid, result.validation.error).toBe(true);
    expect(result.graphChanged).toBe(true);
    expect(result.report.targetNodeIndexes).toEqual([2, 3]);
    expect(result.report.insertedNodeCount).toBeGreaterThan(0);

    const dialogue = result.graph.Nodes.find(node => node.Index === 2)!;
    const rivalDialogue = result.graph.Nodes.find(node => node.Index === 3)!;
    expect(dialogue.Outputs.Actions.length).toBeGreaterThanOrEqual(1);
    expect(rivalDialogue.Outputs.Actions.length).toBeGreaterThanOrEqual(1);

    const tachiNodes = result.graph.Nodes.filter(node => Number(node.NodeType) === Action && node.SubType === 1);
    const artNodes = result.graph.Nodes.filter(node => Number(node.NodeType) === Action && node.SubType === 6);
    const sequenceNodes = result.graph.Nodes.filter(node => Number(node.NodeType) === Action && node.SubType === 7);
    const clearTachiNodes = result.graph.Nodes.filter(node => Number(node.NodeType) === Action && node.SubType === 33);

    expect(tachiNodes).toHaveLength(2);
    expect(artNodes).toHaveLength(1);
    expect(sequenceNodes.length).toBeGreaterThanOrEqual(3);
    expect(clearTachiNodes.length).toBeGreaterThanOrEqual(1);
    expect(tachiNodes[0].Data.TachiIamge).toEqual(stringValue('assets:char.hero'));
    expect(tachiNodes[1].Data.TachiIamge).toEqual(stringValue('assets:char.rival'));
    expect(artNodes[0].Data.IllustrationImage).toEqual(stringValue('assets:cg.reveal'));
    expect(result.report.placedAssets.every(item => item.placementReason && item.confidence)).toBe(true);
  });

  it('is idempotent for the same assets on the same target nodes', () => {
    const first = orchestrateVNGraphVisuals({
      graph: graphFixture(),
      assets: visualAssets(),
      knownSpeakers: ['hero', 'rival'],
    });
    const second = orchestrateVNGraphVisuals({
      graph: first.graph,
      assets: visualAssets(),
      knownSpeakers: ['hero', 'rival'],
    });

    expect(second.validation.valid, second.validation.error).toBe(true);
    expect(second.graphChanged).toBe(false);
    expect(second.graph.Nodes).toHaveLength(first.graph.Nodes.length);
    expect(second.report.placedAssets).toHaveLength(0);
  });

  it('keeps graph unchanged when no progress node can host visual actions', () => {
    const graph: VNGraphSaveData = {
      Version: 1,
      StartNodeIndex: 1,
      Nodes: [
        startNode(1, [2]),
        endNode(2),
      ],
    };

    const result = orchestrateVNGraphVisuals({
      graph,
      assets: visualAssets(),
      knownSpeakers: ['hero'],
    });

    expect(result.validation.valid, result.validation.error).toBe(true);
    expect(result.graphChanged).toBe(false);
    expect(result.graph.Nodes).toHaveLength(2);
    expect(result.report.skippedAssets.map(item => item.reason)).toContain('no Dialogue or Paragraph nodes can host visual actions');
  });
});

function visualAssets(): VNGeneratedAssetRecord[] {
  return [{
    assetId: 'char.hero',
    scopedAssetId: 'assets:char.hero',
    category: 'Tachi',
    publicUrl: '/generated-images/hero.png',
    localPath: '/tmp/hero.png',
  }, {
    assetId: 'char.rival',
    scopedAssetId: 'assets:char.rival',
    category: 'Tachi',
    publicUrl: '/generated-images/rival.png',
    localPath: '/tmp/rival.png',
  }, {
    assetId: 'cg.reveal',
    scopedAssetId: 'assets:cg.reveal',
    category: 'Illustration',
    publicUrl: '/generated-images/reveal.png',
    localPath: '/tmp/reveal.png',
  }];
}

function graphFixture(): VNGraphSaveData {
  return {
    Version: 1,
    StartNodeIndex: 1,
    Nodes: [
      startNode(1, [2]),
      dialogueNode(2, [3]),
      rivalDialogueNode(3, [4]),
      paragraphNode(4, [5]),
      endNode(5),
    ],
  };
}

function startNode(index: number, next: number[]): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Progress,
    SubType: 6,
    X: 80,
    Y: 120,
    Data: {},
    Outputs: { Next: next },
  };
}

function dialogueNode(index: number, next: number[]): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Progress,
    SubType: 1,
    X: 360,
    Y: 120,
    Data: {
      SpeakerIdData: stringValue('hero'),
      TextData: stringValue('We made it before sunset.'),
      VoiceIdData: stringValue(''),
    },
    Outputs: { Actions: [], Next: next },
  };
}

function rivalDialogueNode(index: number, next: number[]): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Progress,
    SubType: 1,
    X: 520,
    Y: 120,
    Data: {
      SpeakerIdData: stringValue('rival'),
      TextData: stringValue('I found the secret door first.'),
      VoiceIdData: stringValue(''),
    },
    Outputs: { Actions: [], Next: next },
  };
}

function paragraphNode(index: number, next: number[]): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Progress,
    SubType: 2,
    X: 640,
    Y: 120,
    Data: {
      Lines: listValue([
        objectValue({
          SpeakerId: stringValue('hero'),
          Text: stringValue('The bridge lights came alive.'),
          VoiceId: stringValue(''),
        }),
      ]),
    },
    Outputs: { Actions: [], Next: next },
  };
}

function endNode(index: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Progress,
    SubType: 11,
    X: 920,
    Y: 120,
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

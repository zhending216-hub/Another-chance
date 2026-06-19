import { describe, expect, it } from 'vitest';
import type { VNGraphSaveData, VNNodeSaveData, VNSerializedValue } from '@/lib/vn/types';
import {
  memoryAssetResolver,
  memoryAssetWhitelist,
  parseAndValidateVNGraphJson,
  validateVNGraph,
} from '@/lib/vn/validator';

const Progress = 1;
const Action = 2;

describe('AIVN VNGraph validator', () => {
  it('accepts a valid start-dialogue-end graph', () => {
    const result = validateVNGraph(validGraph(), validationOptions());
    expect(result.valid, result.error).toBe(true);
  });

  it('extracts fenced JSON before validation', () => {
    const raw = '```json\n' + JSON.stringify(validGraph()) + '\n```';
    const result = parseAndValidateVNGraphJson(raw, validationOptions());
    expect(result.valid, result.error).toBe(true);
    expect(result.graph?.Nodes).toHaveLength(3);
  });

  it('rejects bad graph version', () => {
    const graph = validGraph();
    graph.Version = 2;
    expectInvalid(graph, 'Version');
  });

  it('rejects inherited assets in generated graph input', () => {
    const graph = validGraph();
    graph.InheritedAssets = ['assets:bg.demo'];
    expectInvalid(graph, 'InheritedAssets');
  });

  it('rejects duplicate node indexes', () => {
    const graph = validGraph();
    graph.Nodes.push(endNode(2));
    expectInvalid(graph, 'duplicate Index');
  });

  it('rejects missing or mismatched start node', () => {
    const noStart = validGraph();
    noStart.Nodes = noStart.Nodes.filter(node => node.Index !== 1);
    expectInvalid(noStart, 'Start node');

    const mismatch = validGraph();
    mismatch.StartNodeIndex = 2;
    expectInvalid(mismatch, 'StartNodeIndex');
  });

  it('rejects unknown node type', () => {
    const graph = validGraph();
    graph.Nodes[1].SubType = 999;
    expectInvalid(graph, 'unknown type');
  });

  it('rejects missing required dialogue text', () => {
    const graph = validGraph();
    delete graph.Nodes[1].Data.TextData;
    expectInvalid(graph, 'TextData');
  });

  it('rejects bad serialized kind', () => {
    const graph = validGraph();
    graph.Nodes[1].Data.TextData = intValue(1);
    expectInvalid(graph, 'Kind');
  });

  it('rejects unknown speaker ids', () => {
    const graph = validGraph();
    graph.Nodes[1].Data.SpeakerIdData = stringValue('hreo');
    expectInvalid(graph, 'unknown character');
  });

  it('rejects output capacity, target type, missing target, and unknown keys', () => {
    const overCapacity = validGraph();
    overCapacity.Nodes[0].Outputs.Next = [2, 3];
    expectInvalid(overCapacity, 'capacity');

    const wrongType = validGraph();
    wrongType.Nodes[0].Outputs.Next = [4];
    wrongType.Nodes.push(actionNode(4));
    expectInvalid(wrongType, 'invalid type');

    const missingTarget = validGraph();
    missingTarget.Nodes[1].Outputs.Next = [99];
    expectInvalid(missingTarget, 'missing node');

    const unknownKey = validGraph();
    unknownKey.Nodes[1].Outputs.Unknown = [];
    expectInvalid(unknownKey, 'unknown output key');
  });

  it('rejects unreachable nodes', () => {
    const graph = validGraph();
    graph.Nodes.push(dialogueNode(4, []));
    expectInvalid(graph, 'unreachable');
  });

  it('validates choice dynamic output keys from Options list length', () => {
    const graph = choiceGraph();
    expectValid(graph);

    const badDynamicKey = choiceGraph();
    badDynamicKey.Nodes[1].Outputs['Options[1].Next'] = [];
    expectInvalid(badDynamicKey, 'unknown output key');
  });

  it('requires Text in choice options and paragraph lines', () => {
    const choice = choiceGraph();
    delete choice.Nodes[1].Data.Options.Items![0].ObjectValue!.Text;
    expectInvalid(choice, 'Text');

    const paragraph = paragraphGraph();
    delete paragraph.Nodes[1].Data.Lines.Items![0].ObjectValue!.Text;
    expectInvalid(paragraph, 'Text');
  });

  it('validates resource references through whitelist and resolver hooks', () => {
    const graph = startOnlyGraph();
    graph.Nodes[0].Data.BackgroundImage = stringValue('assets:bg.demo.room');

    const valid = validateVNGraph(graph, {
      ...validationOptions(),
      assetWhitelist: memoryAssetWhitelist({ Background: ['assets:bg.demo.room'] }),
      assetResolver: memoryAssetResolver(['assets:bg.demo.room']),
    });
    expect(valid.valid, valid.error).toBe(true);

    const badScope = startOnlyGraph();
    badScope.Nodes[0].Data.BackgroundImage = stringValue('work:bg.demo.room');
    expectInvalid(badScope, 'assets: scoped id', {
      assetWhitelist: memoryAssetWhitelist({ Background: ['work:bg.demo.room'] }),
      assetResolver: memoryAssetResolver(['work:bg.demo.room']),
    });

    const unresolved = startOnlyGraph();
    unresolved.Nodes[0].Data.BackgroundImage = stringValue('assets:bg.demo.room');
    expectInvalid(unresolved, 'unresolved asset', {
      assetWhitelist: memoryAssetWhitelist({ Background: ['assets:bg.demo.room'] }),
      assetResolver: memoryAssetResolver([]),
    });
  });

  it('supports requireEndingTerminal mode', () => {
    expectValid(validGraph(), { requireEndingTerminal: true });

    const emptyExit = validGraph();
    emptyExit.Nodes[1].Outputs.Next = [];
    emptyExit.Nodes = emptyExit.Nodes.slice(0, 2);
    expectInvalid(emptyExit, 'empty progression exit Next', { requireEndingTerminal: true });

    const nonEmptyEnd = validGraph();
    nonEmptyEnd.Nodes[2].Data.Title = stringValue('Visible ending card');
    expectInvalid(nonEmptyEnd, 'empty EndingId, Title, and Subtitle', { requireEndingTerminal: true });

    const twoEnds = choiceGraphWithTwoEnds();
    expectInvalid(twoEnds, 'exactly one reachable End node', { requireEndingTerminal: true });

    const loopingBranch = choiceGraphWithLoopingBranch();
    expectInvalid(loopingBranch, 'cannot reach the terminal End', { requireEndingTerminal: true });
  });
});

function expectValid(graph: VNGraphSaveData, overrides = {}) {
  const result = validateVNGraph(graph, { ...validationOptions(), ...overrides });
  expect(result.valid, result.error).toBe(true);
}

function expectInvalid(graph: VNGraphSaveData, expected: string, overrides = {}) {
  const result = validateVNGraph(graph, { ...validationOptions(), ...overrides });
  expect(result.valid).toBe(false);
  expect(result.error).toContain(expected);
}

function validationOptions() {
  return {
    knownSpeakers: ['hero', 'Hero', 'H'],
  };
}

function validGraph(): VNGraphSaveData {
  return graph([
    startNode(1, [2]),
    dialogueNode(2, [3]),
    endNode(3),
  ]);
}

function startOnlyGraph(): VNGraphSaveData {
  return graph([startNode(1, [])]);
}

function paragraphGraph(): VNGraphSaveData {
  return graph([
    startNode(1, [2]),
    {
      Index: 2,
      DisplayName: '',
      Comment: '',
      NodeType: Progress,
      SubType: 2,
      X: 360,
      Y: 120,
      Data: {
        Lines: listValue([
          objectValue({
            SpeakerId: stringValue('hero'),
            Text: stringValue('Only this line is required.'),
            VoiceId: stringValue(''),
          }),
        ]),
      },
      Outputs: { Actions: [], Next: [] },
    },
  ]);
}

function choiceGraph(): VNGraphSaveData {
  return graph([
    startNode(1, [2]),
    {
      Index: 2,
      DisplayName: '',
      Comment: '',
      NodeType: Progress,
      SubType: 5,
      X: 360,
      Y: 120,
      Data: {
        Options: listValue([
          objectValue({ Text: stringValue('Take the left path') }),
        ]),
      },
      Outputs: { 'Options[0].Next': [3] },
    },
    endNode(3),
  ]);
}

function choiceGraphWithTwoEnds(): VNGraphSaveData {
  const choice = choiceGraph();
  choice.Nodes[1].Data.Options = listValue([
    objectValue({ Text: stringValue('First ending') }),
    objectValue({ Text: stringValue('Second ending') }),
  ]);
  choice.Nodes[1].Outputs = { 'Options[0].Next': [3], 'Options[1].Next': [4] };
  choice.Nodes.push(endNode(4));
  return choice;
}

function choiceGraphWithLoopingBranch(): VNGraphSaveData {
  const choice = choiceGraph();
  choice.Nodes[1].Data.Options = listValue([
    objectValue({ Text: stringValue('End here') }),
    objectValue({ Text: stringValue('Loop forever') }),
  ]);
  choice.Nodes[1].Outputs = { 'Options[0].Next': [3], 'Options[1].Next': [4] };
  choice.Nodes.push(dialogueNode(4, [4]));
  return choice;
}

function graph(nodes: VNNodeSaveData[]): VNGraphSaveData {
  return { Version: 1, StartNodeIndex: 1, Nodes: nodes };
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

function endNode(index: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Progress,
    SubType: 11,
    X: 640,
    Y: 120,
    Data: {
      EndingId: stringValue(''),
      Title: stringValue(''),
      Subtitle: stringValue(''),
    },
    Outputs: {},
  };
}

function actionNode(index: number): VNNodeSaveData {
  return {
    Index: index,
    DisplayName: '',
    Comment: '',
    NodeType: Action,
    SubType: 3,
    X: 640,
    Y: 120,
    Data: {},
    Outputs: {},
  };
}

function stringValue(value: string): VNSerializedValue {
  return { Kind: 'String', StringValue: value };
}

function intValue(value: number): VNSerializedValue {
  return { Kind: 'Int', NumberValue: value };
}

function listValue(items: VNSerializedValue[]): VNSerializedValue {
  return { Kind: 'List', Items: items };
}

function objectValue(value: Record<string, VNSerializedValue>): VNSerializedValue {
  return { Kind: 'Object', ObjectValue: value };
}

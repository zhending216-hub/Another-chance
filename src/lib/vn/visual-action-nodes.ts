import type { VNGeneratedAssetRecord } from './asset-bridge';
import type { VNNodeSaveData, VNSerializedValue } from './types';
import type { VNVisualClearActionKind, VNVisualPlacementPlanItem } from './visual-placement-policy';

const ACTION_NODE_TYPE = 2;
const ACTION_SEQUENCE_SUBTYPE = 7;
const ACTION_ART_SUBTYPE = 6;
const ACTION_TACHI_SUBTYPE = 1;
const ACTION_CLEAR_ALL_TACHIS_SUBTYPE = 33;
const ACTION_CLEAR_ILLUSTRATION_SUBTYPE = 37;

export function buildActionNodesForPlacement(
  placement: VNVisualPlacementPlanItem,
  target: VNNodeSaveData,
  startIndex: number,
): VNNodeSaveData[] {
  const nodes: VNNodeSaveData[] = [];
  let nextIndex = startIndex;
  for (const clear of placement.clearBefore) {
    nodes.push(createClearNode({
      index: nextIndex++,
      target,
      clear,
    }));
  }
  nodes.push(...buildActionNodesForAsset(placement.asset, target, placement.targetNodeIndex, nextIndex));
  return nodes;
}

function buildActionNodesForAsset(
  asset: VNGeneratedAssetRecord,
  target: VNNodeSaveData,
  targetOrdinal: number,
  startIndex: number,
): VNNodeSaveData[] {
  if (asset.category === 'Tachi') {
    return [createTachiNode({
      index: startIndex,
      target,
      targetOrdinal,
      scopedAssetId: asset.scopedAssetId,
      tachiId: tachiIdForAsset(asset),
    })];
  }

  if (asset.category === 'Illustration') {
    return [createArtNode({
      index: startIndex,
      target,
      scopedAssetId: asset.scopedAssetId,
    })];
  }

  return [];
}

export function createSequenceNode(options: {
  index: number;
  target: VNNodeSaveData;
  childIndexes: number[];
}): VNNodeSaveData {
  return {
    Index: options.index,
    DisplayName: 'AIVN visual sequence',
    Comment: `AIVN_VISUAL_ORCHESTRATION:v1 target=${options.target.Index}`,
    NodeType: ACTION_NODE_TYPE,
    SubType: ACTION_SEQUENCE_SUBTYPE,
    X: options.target.X - 260,
    Y: options.target.Y + 160,
    Data: {},
    Outputs: { Actions: options.childIndexes },
  };
}

function createTachiNode(options: {
  index: number;
  target: VNNodeSaveData;
  targetOrdinal: number;
  scopedAssetId: string;
  tachiId: string;
}): VNNodeSaveData {
  const firstTarget = options.targetOrdinal === 0;
  return {
    Index: options.index,
    DisplayName: firstTarget ? 'AIVN tachi enter' : 'AIVN tachi presence',
    Comment: `AIVN_VISUAL_ORCHESTRATION:v1 category=Tachi asset=${options.scopedAssetId} target=${options.target.Index}`,
    NodeType: ACTION_NODE_TYPE,
    SubType: ACTION_TACHI_SUBTYPE,
    X: options.target.X - 520,
    Y: options.target.Y + 160,
    Data: {
      TachiID: stringValue(options.tachiId),
      TachiIamge: stringValue(options.scopedAssetId),
      TargetPosition: vector2Value(tachiPositionForTarget(options.targetOrdinal)),
      EnterType: enumValue(firstTarget ? 'FadeIn' : 'None'),
      Duration: floatValue(firstTarget ? 0.25 : 0),
    },
    Outputs: {},
  };
}

function createArtNode(options: {
  index: number;
  target: VNNodeSaveData;
  scopedAssetId: string;
}): VNNodeSaveData {
  return {
    Index: options.index,
    DisplayName: 'AIVN illustration beat',
    Comment: `AIVN_VISUAL_ORCHESTRATION:v1 category=Illustration asset=${options.scopedAssetId} target=${options.target.Index}`,
    NodeType: ACTION_NODE_TYPE,
    SubType: ACTION_ART_SUBTYPE,
    X: options.target.X - 520,
    Y: options.target.Y + 260,
    Data: {
      IllustrationImage: stringValue(options.scopedAssetId),
      ChangeType: enumValue('FadeIn'),
      Duration: floatValue(0.45),
      PerformanceType: enumValue('None'),
      FocusPoint: vector2Value({ x: 0.5, y: 0.5 }),
      FocusScale: floatValue(1.4),
      FocusHoldDuration: floatValue(0.1),
      HideDialogueDuringPerformance: boolValue(false),
    },
    Outputs: {},
  };
}

function createClearNode(options: {
  index: number;
  target: VNNodeSaveData;
  clear: VNVisualClearActionKind;
}): VNNodeSaveData {
  if (options.clear === 'ClearIllustration') {
    return {
      Index: options.index,
      DisplayName: 'AIVN clear illustration',
      Comment: `AIVN_VISUAL_ORCHESTRATION:v1 clear=Illustration target=${options.target.Index}`,
      NodeType: ACTION_NODE_TYPE,
      SubType: ACTION_CLEAR_ILLUSTRATION_SUBTYPE,
      X: options.target.X - 780,
      Y: options.target.Y + 260,
      Data: {
        ClearType: enumValue('FadeOut'),
        Duration: floatValue(0.25),
      },
      Outputs: {},
    };
  }

  return {
    Index: options.index,
    DisplayName: 'AIVN clear tachis',
    Comment: `AIVN_VISUAL_ORCHESTRATION:v1 clear=Tachis target=${options.target.Index}`,
    NodeType: ACTION_NODE_TYPE,
    SubType: ACTION_CLEAR_ALL_TACHIS_SUBTYPE,
    X: options.target.X - 780,
    Y: options.target.Y + 160,
    Data: {},
    Outputs: {},
  };
}

function tachiIdForAsset(asset: VNGeneratedAssetRecord): string {
  const base = asset.assetId || asset.scopedAssetId.replace(/^assets:/, '');
  return `aivn_${base.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 48) || 'tachi'}`;
}

function tachiPositionForTarget(targetOrdinal: number): { x: number; y: number } {
  const positions = [
    { x: 520, y: 780 },
    { x: 920, y: 780 },
    { x: 720, y: 780 },
  ];
  return positions[targetOrdinal % positions.length];
}

function stringValue(value: string): VNSerializedValue {
  return { Kind: 'String', StringValue: value };
}

function enumValue(value: string): VNSerializedValue {
  return { Kind: 'Enum', StringValue: value };
}

function floatValue(value: number): VNSerializedValue {
  return { Kind: 'Float', NumberValue: value };
}

function boolValue(value: boolean): VNSerializedValue {
  return { Kind: 'Bool', BoolValue: value };
}

function vector2Value(value: { x: number; y: number }): VNSerializedValue {
  return { Kind: 'Vector2', X: value.x, Y: value.y };
}

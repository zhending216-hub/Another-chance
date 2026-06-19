import {
  generatedAssetResolver,
  generatedAssetWhitelist,
  type VNGeneratedAssetRecord,
} from './asset-bridge';
import type {
  VNGraphSaveData,
  VNGraphValidationResult,
  VNNodeSaveData,
  VNSerializedValue,
} from './types';
import { validateVNGraph } from './validator';
import {
  buildVNVisualPlacementPlan,
  type VNVisualClearActionKind,
  type VNVisualPlacementPlanItem,
} from './visual-placement-policy';

export interface VNVisualOrchestrationOptions {
  graph: VNGraphSaveData;
  assets: VNGeneratedAssetRecord[];
  knownSpeakers?: string[];
  requireEndingTerminal?: boolean;
  maxTargetProgressNodes?: number;
}

export interface VNVisualOrchestrationReport {
  changed: boolean;
  insertedNodeCount: number;
  targetNodeIndexes: number[];
  placedAssets: Array<{
    scopedAssetId: string;
    category: string;
    targetNodeIndex: number;
    actionNodeIndexes: number[];
    placementReason?: string;
    confidence?: number;
    clearBefore?: VNVisualClearActionKind[];
  }>;
  skippedAssets: Array<{
    scopedAssetId: string;
    category: string;
    reason: string;
  }>;
}

export interface VNVisualOrchestrationResult {
  graph: VNGraphSaveData;
  graphChanged: boolean;
  report: VNVisualOrchestrationReport;
  validation: VNGraphValidationResult;
}

const PROGRESS_NODE_TYPE = 1;
const ACTION_NODE_TYPE = 2;
const DIALOGUE_SUBTYPE = 1;
const PARAGRAPH_SUBTYPE = 2;
const ACTION_SEQUENCE_SUBTYPE = 7;
const ACTION_ART_SUBTYPE = 6;
const ACTION_TACHI_SUBTYPE = 1;
const ACTION_CLEAR_ALL_TACHIS_SUBTYPE = 33;
const ACTION_CLEAR_ILLUSTRATION_SUBTYPE = 37;

export function orchestrateVNGraphVisuals(
  options: VNVisualOrchestrationOptions,
): VNVisualOrchestrationResult {
  const originalGraph = options.graph;
  const next = cloneGraph(originalGraph);
  const report: VNVisualOrchestrationReport = {
    changed: false,
    insertedNodeCount: 0,
    targetNodeIndexes: [],
    placedAssets: [],
    skippedAssets: [],
  };

  const visualAssets = normalizeVisualAssets(options.assets);
  if (visualAssets.length === 0) {
    const validation = validateOrchestratedGraph(next, options);
    return { graph: next, graphChanged: false, report, validation };
  }

  const placementPlan = buildVNVisualPlacementPlan({
    graph: next,
    assets: visualAssets,
    knownSpeakers: options.knownSpeakers ?? [],
    maxTargetProgressNodes: options.maxTargetProgressNodes,
  });
  report.skippedAssets.push(...placementPlan.skippedAssets);

  if (placementPlan.placements.length === 0) {
    const validation = validateOrchestratedGraph(next, options);
    return { graph: next, graphChanged: false, report, validation };
  }

  let nextIndex = maxNodeIndex(next) + 1;
  const nodesByIndex = () => new Map(next.Nodes.map(node => [node.Index, node]));

  for (const placement of placementPlan.placements) {
    const index = nodesByIndex();
    const target = index.get(placement.targetNodeIndex);
    if (!target) {
      report.skippedAssets.push({
        scopedAssetId: placement.asset.scopedAssetId,
        category: placement.asset.category,
        reason: `planned target node #${placement.targetNodeIndex} is missing`,
      });
      continue;
    }

    if (targetActionTreeHasAsset(target, index, placement.asset.scopedAssetId)) {
      report.skippedAssets.push({
        scopedAssetId: placement.asset.scopedAssetId,
        category: placement.asset.category,
        reason: `target node #${target.Index} already references this asset`,
      });
      continue;
    }

    const actionNodes = buildActionNodesForPlacement(placement, target, nextIndex);
    if (actionNodes.length === 0) {
      report.skippedAssets.push({
        scopedAssetId: placement.asset.scopedAssetId,
        category: placement.asset.category,
        reason: 'asset category is not visually orchestrated',
      });
      continue;
    }

    nextIndex += actionNodes.length;
    const sequence = createSequenceNode({
      index: nextIndex++,
      target,
      childIndexes: actionNodes.map(node => node.Index),
    });
    next.Nodes.push(sequence, ...actionNodes);
    ensureActionsOutput(target).push(sequence.Index);

    const inserted = [sequence.Index, ...actionNodes.map(node => node.Index)];
    if (!report.targetNodeIndexes.includes(target.Index)) report.targetNodeIndexes.push(target.Index);
    report.insertedNodeCount += inserted.length;
    report.placedAssets.push({
      scopedAssetId: placement.asset.scopedAssetId,
      category: placement.asset.category,
      targetNodeIndex: target.Index,
      actionNodeIndexes: inserted,
      placementReason: placement.placementReason,
      confidence: placement.confidence,
      clearBefore: placement.clearBefore,
    });
  }

  report.changed = report.insertedNodeCount > 0;
  const validation = validateOrchestratedGraph(next, options);
  if (!validation.valid) {
    return {
      graph: originalGraph,
      graphChanged: false,
      report: {
        ...report,
        changed: false,
        skippedAssets: [
          ...report.skippedAssets,
          ...visualAssets.map(asset => ({
            scopedAssetId: asset.scopedAssetId,
            category: asset.category,
            reason: `orchestrated graph failed validation: ${validation.error}`,
          })),
        ],
      },
      validation,
    };
  }

  return {
    graph: next,
    graphChanged: report.changed,
    report,
    validation,
  };
}

function buildActionNodesForPlacement(
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

function createSequenceNode(options: {
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

function stageableProgressNodes(graph: VNGraphSaveData): VNNodeSaveData[] {
  return graph.Nodes
    .filter(node => Number(node.NodeType) === PROGRESS_NODE_TYPE &&
      (node.SubType === DIALOGUE_SUBTYPE || node.SubType === PARAGRAPH_SUBTYPE))
    .sort((left, right) => left.Index - right.Index);
}

function normalizeVisualAssets(assets: VNGeneratedAssetRecord[]): VNGeneratedAssetRecord[] {
  const seen = new Set<string>();
  const result: VNGeneratedAssetRecord[] = [];
  for (const asset of assets) {
    if (!asset.scopedAssetId?.startsWith('assets:')) continue;
    if (asset.category !== 'Tachi' && asset.category !== 'Illustration') continue;
    const key = `${asset.category}:${asset.scopedAssetId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(asset);
  }
  return result.sort((left, right) => categoryRank(left.category) - categoryRank(right.category));
}

function categoryRank(category: string): number {
  if (category === 'Illustration') return 0;
  if (category === 'Tachi') return 1;
  return 9;
}

function targetActionTreeHasAsset(
  target: VNNodeSaveData,
  nodesByIndex: Map<number, VNNodeSaveData>,
  scopedAssetId: string,
): boolean {
  const roots = target.Outputs?.Actions;
  if (!Array.isArray(roots) || roots.length === 0) return false;
  const visited = new Set<number>();
  const stack = [...roots];
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (visited.has(index)) continue;
    visited.add(index);
    const node = nodesByIndex.get(index);
    if (!node) continue;
    if (nodeDataHasString(node.Data, scopedAssetId)) return true;
    for (const targets of Object.values(node.Outputs ?? {})) {
      if (!Array.isArray(targets)) continue;
      for (const targetIndex of targets) {
        const targetNode = nodesByIndex.get(targetIndex);
        if (targetNode && Number(targetNode.NodeType) === ACTION_NODE_TYPE) {
          stack.push(targetIndex);
        }
      }
    }
  }
  return false;
}

function nodeDataHasString(value: unknown, expected: string): boolean {
  if (!value || typeof value !== 'object') return false;
  const serialized = value as VNSerializedValue;
  if (serialized.Kind === 'String' && serialized.StringValue === expected) return true;
  if (Array.isArray(serialized.Items) && serialized.Items.some(item => nodeDataHasString(item, expected))) return true;
  if (serialized.ObjectValue && Object.values(serialized.ObjectValue).some(item => nodeDataHasString(item, expected))) return true;
  return Object.values(value as Record<string, unknown>).some(item => nodeDataHasString(item, expected));
}

function ensureActionsOutput(node: VNNodeSaveData): number[] {
  if (!node.Outputs) node.Outputs = {};
  if (!Array.isArray(node.Outputs.Actions)) node.Outputs.Actions = [];
  return node.Outputs.Actions;
}

function validateOrchestratedGraph(
  graph: VNGraphSaveData,
  options: VNVisualOrchestrationOptions,
): VNGraphValidationResult {
  return validateVNGraph(graph, {
    requireEndingTerminal: options.requireEndingTerminal ?? true,
    knownSpeakers: options.knownSpeakers ?? [],
    assetWhitelist: generatedAssetWhitelist(options.assets),
    assetResolver: generatedAssetResolver(options.assets),
  });
}

function maxNodeIndex(graph: VNGraphSaveData): number {
  return graph.Nodes.reduce((max, node) => Math.max(max, node.Index), 0);
}

function cloneGraph(graph: VNGraphSaveData): VNGraphSaveData {
  return JSON.parse(JSON.stringify(graph)) as VNGraphSaveData;
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

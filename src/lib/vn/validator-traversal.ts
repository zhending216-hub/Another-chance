import type {
  VNDynamicOutputSchema,
  VNNodeFactorySchema,
  VNNodeSaveData,
  VNOutputSchema,
  VNOutputSpec,
  VNSerializedValue,
} from './types';

const NODE_TYPE_VALUES: Record<string, number> = {
  Progress: 1,
  Action: 2,
  Condition: 3,
};

const PROGRESS_NODE_TYPE = 1;
const START_SUBTYPE = 6;
const END_SUBTYPE = 11;

export function buildOutputSpecs(factory: VNNodeFactorySchema, data: Record<string, VNSerializedValue>): Map<string, VNOutputSpec> {
  const specs = new Map<string, VNOutputSpec>();
  for (const output of factory.Outputs ?? []) {
    specs.set(output.Key, outputSpecFrom(output));
  }
  for (const dynamicOutput of factory.DynamicOutputs ?? []) {
    const list = data[dynamicOutput.ListFieldName];
    const count = list?.Kind === 'List' && Array.isArray(list.Items) ? list.Items.length : 0;
    for (let i = 0; i < count; i++) {
      const key = dynamicOutput.KeyTemplate.replace('[i]', `[${i}]`);
      specs.set(key, outputSpecFrom(dynamicOutput, key));
    }
  }
  return specs;
}

function outputSpecFrom(output: VNOutputSchema | VNDynamicOutputSchema, key?: string): VNOutputSpec {
  const outputKey = key ?? ('Key' in output ? output.Key : output.KeyTemplate);
  return {
    Key: outputKey,
    Capacity: output.Capacity ?? 0,
    AllowedTargetTypeValues: output.AllowedTargetTypeValues ?? [],
    TargetsProgress: !!output.TargetsProgress,
  };
}

export function collectReachableNodeIndexes(startNodeIndex: number, nodesByIndex: Map<number, VNNodeSaveData>): Set<number> {
  const visited = new Set<number>();
  const stack = [startNodeIndex];
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (visited.has(index)) continue;
    const node = nodesByIndex.get(index);
    if (!node) continue;
    visited.add(index);
    for (const targets of Object.values(node.Outputs ?? {})) {
      if (!Array.isArray(targets)) continue;
      for (const target of targets) stack.push(target);
    }
  }
  return visited;
}

export function collectNodesThatCanReachEnd(
  reachable: Set<number>,
  nodesByIndex: Map<number, VNNodeSaveData>,
  schemaIndex: Map<string, VNNodeFactorySchema>,
): Set<number> {
  const reverse = new Map<number, number[]>();
  const endIndexes: number[] = [];
  for (const index of reachable) {
    const node = nodesByIndex.get(index);
    if (!node) continue;
    if (isEndNode(node)) endIndexes.push(index);
    for (const target of progressionTargets(node, schemaIndex)) {
      if (!reachable.has(target)) continue;
      const incoming = reverse.get(target) ?? [];
      incoming.push(index);
      reverse.set(target, incoming);
    }
  }

  const canReachEnd = new Set<number>();
  const stack = [...endIndexes];
  while (stack.length > 0) {
    const index = stack.pop()!;
    if (canReachEnd.has(index)) continue;
    canReachEnd.add(index);
    for (const source of reverse.get(index) ?? []) stack.push(source);
  }
  return canReachEnd;
}

function progressionTargets(node: VNNodeSaveData, schemaIndex: Map<string, VNNodeFactorySchema>): number[] {
  const factory = schemaIndex.get(factoryKey(normalizeNodeTypeValue(node.NodeType) ?? -1, node.SubType));
  if (!factory) return [];
  const specs = buildOutputSpecs(factory, node.Data ?? {});
  const targets: number[] = [];
  for (const spec of specs.values()) {
    if (!spec.TargetsProgress) continue;
    const values = node.Outputs?.[spec.Key];
    if (Array.isArray(values)) targets.push(...values);
  }
  return targets;
}

export function hasProgressionOutput(node: VNNodeSaveData, schemaIndex: Map<string, VNNodeFactorySchema>): boolean {
  const factory = schemaIndex.get(factoryKey(normalizeNodeTypeValue(node.NodeType) ?? -1, node.SubType));
  if (!factory) return false;
  for (const spec of buildOutputSpecs(factory, node.Data ?? {}).values()) {
    if (spec.TargetsProgress) return true;
  }
  return false;
}

export function isStartNode(node: VNNodeSaveData): boolean {
  return normalizeNodeTypeValue(node.NodeType) === PROGRESS_NODE_TYPE && node.SubType === START_SUBTYPE;
}

export function isEndNode(node: VNNodeSaveData): boolean {
  return normalizeNodeTypeValue(node.NodeType) === PROGRESS_NODE_TYPE && node.SubType === END_SUBTYPE;
}

export function normalizeNodeTypeValue(value: number | string | undefined | null): number | null {
  if (typeof value === 'number' && Number.isInteger(value)) return value;
  if (typeof value === 'string') return NODE_TYPE_VALUES[value] ?? null;
  return null;
}

export function factoryKey(nodeTypeValue: number, subType: number): string {
  return `${nodeTypeValue}:${subType}`;
}

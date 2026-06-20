import rawSchema from './schema/vn-node-schema.json';
import type {
  VNAssetResolver,
  VNAssetWhitelist,
  VNCharacterEntry,
  VNCharacterTable,
  VNGraphSaveData,
  VNGraphValidationOptions,
  VNGraphValidationResult,
  VNNodeFactorySchema,
  VNNodeSaveData,
  VNNodeSchemaDocument,
  VNOutputSpec,
  VNSerializedValue,
  VNValueSchema,
} from './types';
import { validateResourceFields, normalizeAssetId } from './validator-assets';
import {
  buildOutputSpecs,
  collectNodesThatCanReachEnd,
  collectReachableNodeIndexes,
  factoryKey,
  hasProgressionOutput,
  isEndNode,
  isStartNode,
  normalizeNodeTypeValue,
} from './validator-traversal';

const defaultSchema = rawSchema as unknown as VNNodeSchemaDocument;

const REQUIRED_TEXT_OBJECT_PATHS = new Set(['Options[]', 'Lines[]']);

export function parseAndValidateVNGraphJson(
  text: string,
  options: VNGraphValidationOptions = {},
): { graph: VNGraphSaveData | null } & VNGraphValidationResult {
  const graphJson = extractJsonObject(text);
  if (!graphJson) {
    return { graph: null, ...fail('Generated graph JSON is empty.') };
  }

  let graph: VNGraphSaveData;
  try {
    graph = JSON.parse(graphJson) as VNGraphSaveData;
  } catch (error) {
    return {
      graph: null,
      ...fail(`Generated graph JSON is invalid: ${error instanceof Error ? error.message : String(error)}`),
    };
  }

  const result = validateVNGraph(graph, options);
  return { graph: result.valid ? graph : null, ...result };
}

export function validateVNGraph(
  graph: VNGraphSaveData,
  options: VNGraphValidationOptions = {},
): VNGraphValidationResult {
  const schema = options.schema ?? defaultSchema;
  const schemaIndex = buildSchemaIndex(schema);
  const version = schema.GraphRules?.VersionMustEqual ?? schema.GraphVersion;

  if (!isRecord(graph)) {
    return fail('Generated graph is null.');
  }

  if (graph.Version !== version) {
    return fail(`Generated graph Version must be ${version}, got ${String(graph.Version)}.`);
  }

  if (Array.isArray(graph.InheritedAssets) && graph.InheritedAssets.length > 0) {
    return fail('Generated graph must not declare InheritedAssets; fork context is injected by runtime.');
  }

  if (!Array.isArray(graph.Nodes) || graph.Nodes.length === 0) {
    return fail('Generated graph has no nodes.');
  }

  const nodeIndexResult = buildNodeIndex(graph.Nodes);
  if (!nodeIndexResult.valid) return nodeIndexResult.result;
  const nodesByIndex = nodeIndexResult.nodesByIndex;

  const startResult = validateStartNode(graph, nodesByIndex);
  if (!startResult.valid) return startResult;

  for (const node of graph.Nodes) {
    const nodeType = normalizeNodeTypeValue(node?.NodeType);
    const factory = nodeType == null ? null : schemaIndex.get(factoryKey(nodeType, node.SubType));
    if (!factory) {
      return fail(`Node #${String(node?.Index)} has unknown type: ${String(node?.NodeType)}/${String(node?.SubType)}.`);
    }

    const nodeResult = validateNode(node, factory, nodesByIndex, options);
    if (!nodeResult.valid) return nodeResult;
  }

  const reachability = validateReachability(graph.StartNodeIndex, nodesByIndex);
  if (!reachability.valid) return reachability;

  if (options.requireEndingTerminal) {
    const terminal = validateEndingTerminal(graph.StartNodeIndex, nodesByIndex, schemaIndex);
    if (!terminal.valid) return terminal;
  }

  return ok();
}

export function extractJsonObject(text: string): string {
  let value = (text ?? '').trim();
  if (value.startsWith('```')) {
    const firstNewline = value.indexOf('\n');
    const lastFence = value.lastIndexOf('```');
    if (firstNewline >= 0 && lastFence > firstNewline) {
      value = value.slice(firstNewline + 1, lastFence).trim();
    }
  }

  const start = value.indexOf('{');
  const end = value.lastIndexOf('}');
  if (start < 0 || end <= start) return '';
  return value.slice(start, end + 1);
}

function validateNode(
  node: VNNodeSaveData,
  factory: VNNodeFactorySchema,
  nodesByIndex: Map<number, VNNodeSaveData>,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  if (!isRecord(node)) return fail('Generated graph contains a null node.');
  if (!Number.isFinite(node.X) || !Number.isFinite(node.Y)) {
    return fail(`Node #${node.Index} has invalid coordinates.`);
  }
  if (!isRecord(node.Data)) return fail(`Node #${node.Index} Data is null.`);
  if (!isRecord(node.Outputs)) return fail(`Node #${node.Index} Outputs is null.`);

  const dataResult = validateData(node, factory, options);
  if (!dataResult.valid) return dataResult;

  const resourceResult = validateResourceFields(node, factory.ResourceFields ?? [], options);
  if (!resourceResult.valid) return resourceResult;

  const outputSpecs = buildOutputSpecs(factory, node.Data);
  return validateOutputs(node, nodesByIndex, outputSpecs);
}

function validateData(
  node: VNNodeSaveData,
  factory: VNNodeFactorySchema,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  for (const key of factory.RequiredDataFields ?? []) {
    if (!Object.prototype.hasOwnProperty.call(node.Data, key)) {
      return fail(`Node #${node.Index} missing required Data field: ${key}.`);
    }
  }

  for (const constraint of factory.RequiredListConstraints ?? []) {
    const value = node.Data[constraint.Field];
    const count = value?.Items?.length ?? 0;
    const min = constraint.MinItems ?? 0;
    const max = constraint.MaxItems ?? Number.MAX_SAFE_INTEGER;
    if (count < min || count > max) {
      const expected = max === Number.MAX_SAFE_INTEGER ? `at least ${min}` : `${min}-${max}`;
      return fail(`Node #${node.Index} required Data field ${constraint.Field} must contain ${expected} item(s).`);
    }
  }

  for (const [key, value] of Object.entries(node.Data)) {
    const valueSchema = factory.Fields[key];
    if (!valueSchema) {
      return fail(`Node #${node.Index} has unknown Data field: ${key}.`);
    }

    const shape = validateValueShape(`node #${node.Index}.${key}`, key, value, valueSchema, options);
    if (!shape.valid) return shape;
  }

  return ok();
}

function validateValueShape(
  displayPath: string,
  schemaPath: string,
  value: VNSerializedValue,
  valueSchema: VNValueSchema,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  if (!isRecord(value)) return fail(`${displayPath} is null.`);
  if (!valueSchema) return fail(`${displayPath} has no schema.`);
  if (value.Kind !== valueSchema.Kind) {
    return fail(`${displayPath} has Kind ${String(value.Kind)}, expected ${valueSchema.Kind}.`);
  }

  switch (valueSchema.Kind) {
    case 'Null':
      return ok();
    case 'String': {
      if (value.StringValue == null) return fail(`${displayPath} StringValue is null.`);
      if (isSpeakerField(schemaPath) && !isKnownSpeaker(options, value.StringValue)) {
        return fail(`${displayPath} uses unknown character name: ${value.StringValue}.`);
      }
      return ok();
    }
    case 'Int':
      return Number.isInteger(value.NumberValue)
        ? ok()
        : fail(`${displayPath} must be an integer.`);
    case 'Float':
    case 'Double':
      return Number.isFinite(value.NumberValue)
        ? ok()
        : fail(`${displayPath} must be finite.`);
    case 'Bool':
      return ok();
    case 'Enum':
      if (!value.StringValue) return fail(`${displayPath} enum value is empty.`);
      if (!valueSchema.CollisionRelaxed && valueSchema.EnumValues && !valueSchema.EnumValues.includes(value.StringValue)) {
        return fail(`${displayPath} enum value is invalid: ${value.StringValue}.`);
      }
      return ok();
    case 'Vector2':
      return finiteFields(value, ['X', 'Y']) ? ok() : fail(`${displayPath} has invalid Vector2 coordinates.`);
    case 'Vector3':
      return finiteFields(value, ['X', 'Y', 'Z']) ? ok() : fail(`${displayPath} has invalid Vector3 coordinates.`);
    case 'Color':
      return finiteFields(value, ['X', 'Y', 'Z', 'W']) ? ok() : fail(`${displayPath} has invalid Color components.`);
    case 'List':
      return validateList(displayPath, schemaPath, value, valueSchema, options);
    case 'Object':
      return validateObject(displayPath, schemaPath, value, valueSchema, options);
    default:
      return fail(`${displayPath} has unsupported Kind: ${valueSchema.Kind}.`);
  }
}

function validateList(
  displayPath: string,
  schemaPath: string,
  value: VNSerializedValue,
  valueSchema: VNValueSchema,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  if (!Array.isArray(value.Items)) return fail(`${displayPath} list Items is null.`);
  if (!valueSchema.ItemSchema) return ok();

  for (let i = 0; i < value.Items.length; i++) {
    const itemResult = validateValueShape(`${displayPath}[${i}]`, `${schemaPath}[]`, value.Items[i], valueSchema.ItemSchema, options);
    if (!itemResult.valid) return itemResult;
  }

  return ok();
}

function validateObject(
  displayPath: string,
  schemaPath: string,
  value: VNSerializedValue,
  valueSchema: VNValueSchema,
  options: VNGraphValidationOptions,
): VNGraphValidationResult {
  if (!isRecord(value.ObjectValue)) return fail(`${displayPath} ObjectValue is null.`);
  const objectSchema = valueSchema.ObjectSchema ?? {};
  const requiredFields = new Set(valueSchema.RequiredFields ?? []);
  if (REQUIRED_TEXT_OBJECT_PATHS.has(schemaPath)) requiredFields.add('Text');

  for (const key of requiredFields) {
    if (!Object.prototype.hasOwnProperty.call(value.ObjectValue, key)) {
      return fail(`${displayPath} missing required object field: ${key}.`);
    }
  }

  for (const [key, childValue] of Object.entries(value.ObjectValue)) {
    const childSchema = objectSchema[key];
    if (!childSchema) return fail(`${displayPath} has unknown object field: ${key}.`);
    const childResult = validateValueShape(`${displayPath}.${key}`, `${schemaPath}.${key}`, childValue, childSchema, options);
    if (!childResult.valid) return childResult;
  }

  return ok();
}

function validateOutputs(
  node: VNNodeSaveData,
  nodesByIndex: Map<number, VNNodeSaveData>,
  outputSpecs: Map<string, VNOutputSpec>,
): VNGraphValidationResult {
  for (const [key, targets] of Object.entries(node.Outputs)) {
    const spec = outputSpecs.get(key);
    if (!spec) return fail(`Node #${node.Index} has unknown output key: ${key}.`);
    if (!Array.isArray(targets)) return fail(`Node #${node.Index} output ${key} is null.`);
    if (spec.Capacity > 0 && targets.length > spec.Capacity) {
      return fail(`Node #${node.Index} output ${key} exceeds capacity ${spec.Capacity}.`);
    }

    for (const targetIndex of targets) {
      if (!Number.isInteger(targetIndex)) return fail(`Node #${node.Index} output ${key} contains a non-integer target.`);
      const targetNode = nodesByIndex.get(targetIndex);
      if (!targetNode) return fail(`Node #${node.Index} output ${key} targets missing node #${targetIndex}.`);
      const targetNodeType = normalizeNodeTypeValue(targetNode.NodeType);
      if (spec.AllowedTargetTypeValues.length > 0 && !spec.AllowedTargetTypeValues.includes(targetNodeType ?? -1)) {
        return fail(`Node #${node.Index} output ${key} targets node #${targetIndex} with invalid type ${String(targetNode.NodeType)}.`);
      }
    }
  }

  return ok();
}

function validateReachability(startNodeIndex: number, nodesByIndex: Map<number, VNNodeSaveData>): VNGraphValidationResult {
  const visited = collectReachableNodeIndexes(startNodeIndex, nodesByIndex);
  for (const index of nodesByIndex.keys()) {
    if (!visited.has(index)) return fail(`Node #${index} is unreachable from StartNodeIndex.`);
  }
  return ok();
}

function validateEndingTerminal(
  startNodeIndex: number,
  nodesByIndex: Map<number, VNNodeSaveData>,
  schemaIndex: Map<string, VNNodeFactorySchema>,
): VNGraphValidationResult {
  const reachable = collectReachableNodeIndexes(startNodeIndex, nodesByIndex);
  const reachableEnds: VNNodeSaveData[] = [];

  for (const index of reachable) {
    const node = nodesByIndex.get(index);
    if (!node) continue;
    if (isEndNode(node)) {
      reachableEnds.push(node);
      continue;
    }

    const factory = schemaIndex.get(factoryKey(normalizeNodeTypeValue(node.NodeType) ?? -1, node.SubType));
    if (!factory) return fail(`Node #${node.Index} has unknown type: ${String(node.NodeType)}/${String(node.SubType)}.`);
    const outputSpecs = buildOutputSpecs(factory, node.Data);
    for (const spec of outputSpecs.values()) {
      if (!spec.TargetsProgress) continue;
      const targets = node.Outputs?.[spec.Key];
      if (!Array.isArray(targets) || targets.length === 0) {
        return fail(`Continuation graph node #${node.Index} has empty progression exit ${spec.Key}. Connect it to the terminal End node.`);
      }
    }
  }

  if (reachableEnds.length !== 1) {
    return fail(`Continuation graph must contain exactly one reachable End node, got ${reachableEnds.length}.`);
  }

  if (!isCleanContinuationEndNode(reachableEnds[0])) {
    return fail(`Continuation graph End node #${reachableEnds[0].Index} must have empty EndingId, Title, and Subtitle fields.`);
  }

  const canReachEnd = collectNodesThatCanReachEnd(reachable, nodesByIndex, schemaIndex);
  for (const index of reachable) {
    const node = nodesByIndex.get(index);
    if (!node || isEndNode(node) || !hasProgressionOutput(node, schemaIndex)) continue;
    if (!canReachEnd.has(index)) {
      return fail(`Continuation graph node #${index} cannot reach the terminal End node through progression exits.`);
    }
  }

  return ok();
}

function buildNodeIndex(nodes: VNNodeSaveData[]): { valid: true; nodesByIndex: Map<number, VNNodeSaveData> } | { valid: false; result: VNGraphValidationResult } {
  const nodesByIndex = new Map<number, VNNodeSaveData>();
  for (const node of nodes) {
    if (!isRecord(node)) return { valid: false, result: fail('Generated graph contains a null node.') };
    if (!Number.isInteger(node.Index) || node.Index <= 0) {
      return { valid: false, result: fail('Generated graph contains a node with missing or invalid Index.') };
    }
    if (nodesByIndex.has(node.Index)) {
      return { valid: false, result: fail(`Generated graph contains duplicate Index #${node.Index}.`) };
    }
    nodesByIndex.set(node.Index, node);
  }
  return { valid: true, nodesByIndex };
}

function validateStartNode(graph: VNGraphSaveData, nodesByIndex: Map<number, VNNodeSaveData>): VNGraphValidationResult {
  const starts = [...nodesByIndex.values()].filter(isStartNode);
  if (starts.length === 0) return fail('Generated graph must contain one Start node.');
  if (starts.length > 1) return fail(`Generated graph must contain exactly one Start node, got ${starts.length}.`);
  const startIndex = starts[0].Index;
  if (graph.StartNodeIndex !== startIndex) {
    return fail(`StartNodeIndex #${graph.StartNodeIndex} must point to the single Start node #${startIndex}.`);
  }
  if (!nodesByIndex.has(graph.StartNodeIndex)) return fail(`StartNodeIndex target does not exist: #${graph.StartNodeIndex}.`);
  return ok();
}

function buildSchemaIndex(schema: VNNodeSchemaDocument): Map<string, VNNodeFactorySchema> {
  const result = new Map<string, VNNodeFactorySchema>();
  for (const node of schema.Nodes ?? []) {
    result.set(factoryKey(node.NodeTypeValue, node.SubType), node);
  }
  return result;
}

function isKnownSpeaker(options: VNGraphValidationOptions, speakerId: string): boolean {
  const speaker = speakerId.trim();
  if (!speaker) return true;
  if (options.characterTable?.isKnownSpeaker) return options.characterTable.isKnownSpeaker(speaker);
  const names = new Set<string>((options.knownSpeakers ?? []).map(v => v.trim()).filter(Boolean));
  for (const entry of characterEntries(options.characterTable)) {
    for (const name of characterNames(entry)) names.add(name);
  }
  return names.has(speaker);
}

function characterEntries(table?: VNCharacterTable): VNCharacterEntry[] {
  return table?.entries ?? table?.Entries ?? [];
}

function characterNames(entry: VNCharacterEntry): string[] {
  return [entry.id, entry.Id, entry.displayName, entry.DisplayName, entry.name, entry.Name, ...(entry.aliases ?? []), ...(entry.Aliases ?? [])]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .map(value => value.trim());
}

function isCleanContinuationEndNode(node: VNNodeSaveData): boolean {
  return !readString(node.Data?.EndingId) && !readString(node.Data?.Title) && !readString(node.Data?.Subtitle);
}

function readString(value?: VNSerializedValue): string {
  return value?.Kind === 'String' ? (value.StringValue ?? '').trim() : '';
}

function isSpeakerField(schemaPath: string): boolean {
  const leaf = leafName(schemaPath);
  return leaf === 'SpeakerIdData' || leaf === 'SpeakerId';
}

function leafName(path: string): string {
  let text = path ?? '';
  const dotIndex = text.lastIndexOf('.');
  if (dotIndex >= 0) text = text.slice(dotIndex + 1);
  const bracketIndex = text.indexOf(']');
  if (bracketIndex >= 0 && bracketIndex < text.length - 1) {
    text = text.slice(bracketIndex + 1).replace(/^\./, '');
  }
  if (text.endsWith('[]')) text = text.slice(0, -2);
  return text;
}

function finiteFields(value: VNSerializedValue, fields: Array<'X' | 'Y' | 'Z' | 'W'>): boolean {
  return fields.every(field => Number.isFinite(value[field]));
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function ok(): VNGraphValidationResult {
  return { valid: true, error: '', errors: [] };
}

function fail(error: string): VNGraphValidationResult {
  return { valid: false, error, errors: [error] };
}

export function memoryAssetWhitelist(entries: Record<string, string[]>): VNAssetWhitelist {
  const normalized = new Map<string, Set<string>>();
  for (const [category, values] of Object.entries(entries)) {
    normalized.set(category.toLowerCase(), new Set(values.map(normalizeAssetId)));
  }
  return {
    contains(category: string, scopedAssetId: string) {
      return normalized.get(category.toLowerCase())?.has(normalizeAssetId(scopedAssetId)) ?? false;
    },
  };
}

export function memoryAssetResolver(loadableAssets: string[]): VNAssetResolver {
  const loadable = new Set(loadableAssets.map(normalizeAssetId));
  return {
    resolve(scopedAssetId: string) {
      return loadable.has(normalizeAssetId(scopedAssetId)) ? 'memory://asset' : false;
    },
  };
}

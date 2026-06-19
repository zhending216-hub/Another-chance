import type { VNGeneratedAssetRecord } from './asset-bridge';
import type { VNGraphSaveData, VNNodeSaveData, VNSerializedValue } from './types';

export type VNVisualPlacementActionKind = 'Tachi' | 'Illustration';
export type VNVisualClearActionKind = 'ClearAllTachis' | 'ClearIllustration';

export interface VNVisualPlacementPolicyOptions {
  graph: VNGraphSaveData;
  assets: VNGeneratedAssetRecord[];
  knownSpeakers?: string[];
  maxTargetProgressNodes?: number;
  maxIllustrationsPerChapter?: number;
  maxTachiPlacementsPerAsset?: number;
}

export interface VNVisualPlacementPlanItem {
  targetNodeIndex: number;
  asset: VNGeneratedAssetRecord;
  actionKind: VNVisualPlacementActionKind;
  placementReason: string;
  confidence: number;
  required: boolean;
  clearBefore: VNVisualClearActionKind[];
}

export interface VNVisualPlacementSkippedAsset {
  scopedAssetId: string;
  category: string;
  reason: string;
}

export interface VNVisualPlacementPlan {
  placements: VNVisualPlacementPlanItem[];
  skippedAssets: VNVisualPlacementSkippedAsset[];
  warnings: string[];
}

interface StageableNode {
  node: VNNodeSaveData;
  order: number;
  text: string;
  speakers: string[];
  primarySpeaker: string;
}

interface ScoredTarget {
  target: StageableNode;
  score: number;
  reason: string;
}

const PROGRESS_NODE_TYPE = 1;
const DIALOGUE_SUBTYPE = 1;
const PARAGRAPH_SUBTYPE = 2;
const CHOICE_SUBTYPE = 5;
const DEFAULT_MAX_ILLUSTRATIONS = 1;
const DEFAULT_MAX_TACHI_PER_ASSET = 1;

export function buildVNVisualPlacementPlan(
  options: VNVisualPlacementPolicyOptions,
): VNVisualPlacementPlan {
  const targets = collectStageableNodes(options.graph)
    .slice(0, Math.max(1, options.maxTargetProgressNodes ?? Number.MAX_SAFE_INTEGER));
  const assets = normalizeVisualAssets(options.assets);
  const plan: VNVisualPlacementPlan = {
    placements: [],
    skippedAssets: [],
    warnings: [],
  };

  if (assets.length === 0) return plan;
  if (targets.length === 0) {
    for (const asset of assets) {
      plan.skippedAssets.push({
        scopedAssetId: asset.scopedAssetId,
        category: asset.category,
        reason: 'no Dialogue or Paragraph nodes can host visual actions',
      });
    }
    return plan;
  }

  const knownSpeakers = normalizeNameSet(options.knownSpeakers ?? []);
  const activeTachiBySpeaker = new Map<string, string>();
  let activeIllustration = false;

  for (const asset of assets.filter(asset => asset.category === 'Tachi')) {
    const matches = scoreTachiTargets(asset, targets, knownSpeakers);
    const limit = Math.max(1, options.maxTachiPlacementsPerAsset ?? DEFAULT_MAX_TACHI_PER_ASSET);
    const selected = selectDistinctTargets(matches, limit);

    if (selected.length === 0) {
      plan.skippedAssets.push({
        scopedAssetId: asset.scopedAssetId,
        category: asset.category,
        reason: 'no speaker-aware target matched this Tachi asset',
      });
      continue;
    }

    for (const match of selected) {
      const speakerKey = normalizeName(match.target.primarySpeaker);
      const clearBefore: VNVisualClearActionKind[] = [];
      if (activeIllustration) {
        clearBefore.push('ClearIllustration');
        activeIllustration = false;
      }
      if (speakerKey && activeTachiBySpeaker.size > 0 && activeTachiBySpeaker.get(speakerKey) !== asset.scopedAssetId) {
        clearBefore.push('ClearAllTachis');
        activeTachiBySpeaker.clear();
      }

      if (speakerKey) activeTachiBySpeaker.set(speakerKey, asset.scopedAssetId);
      plan.placements.push({
        targetNodeIndex: match.target.node.Index,
        asset,
        actionKind: 'Tachi',
        placementReason: match.reason,
        confidence: clampConfidence(match.score),
        required: false,
        clearBefore,
      });
    }
  }

  const illustrationLimit = Math.max(0, options.maxIllustrationsPerChapter ?? DEFAULT_MAX_ILLUSTRATIONS);
  let illustrationCount = 0;
  for (const asset of assets.filter(asset => asset.category === 'Illustration')) {
    if (illustrationCount >= illustrationLimit) {
      plan.skippedAssets.push({
        scopedAssetId: asset.scopedAssetId,
        category: asset.category,
        reason: `Illustration cap reached (${illustrationLimit})`,
      });
      continue;
    }

    const match = scoreIllustrationTargets(asset, targets)[0];
    if (!match) {
      plan.skippedAssets.push({
        scopedAssetId: asset.scopedAssetId,
        category: asset.category,
        reason: 'no high-value Illustration beat found',
      });
      continue;
    }

    const clearBefore: VNVisualClearActionKind[] = activeIllustration ? ['ClearIllustration'] : [];
    activeIllustration = true;
    illustrationCount += 1;
    plan.placements.push({
      targetNodeIndex: match.target.node.Index,
      asset,
      actionKind: 'Illustration',
      placementReason: match.reason,
      confidence: clampConfidence(match.score),
      required: false,
      clearBefore,
    });
  }

  plan.placements.sort((left, right) => {
    const leftOrder = targets.find(target => target.node.Index === left.targetNodeIndex)?.order ?? 0;
    const rightOrder = targets.find(target => target.node.Index === right.targetNodeIndex)?.order ?? 0;
    return leftOrder - rightOrder || actionRank(left.actionKind) - actionRank(right.actionKind);
  });

  if (plan.placements.length === 0 && plan.skippedAssets.length === 0) {
    plan.warnings.push('visual assets were present but no placement was selected');
  }

  return plan;
}

export function collectStageableNodes(graph: VNGraphSaveData): StageableNode[] {
  return [...(graph.Nodes ?? [])]
    .filter(node => Number(node.NodeType) === PROGRESS_NODE_TYPE &&
      (node.SubType === DIALOGUE_SUBTYPE || node.SubType === PARAGRAPH_SUBTYPE || node.SubType === CHOICE_SUBTYPE))
    .sort((left, right) => left.Index - right.Index)
    .map((node, order) => {
      const speakers = extractSpeakers(node);
      return {
        node,
        order,
        text: extractText(node),
        speakers,
        primarySpeaker: speakers[0] ?? '',
      };
    })
    .filter(target => target.node.SubType === CHOICE_SUBTYPE || target.text.trim().length > 0 || target.speakers.length > 0);
}

function scoreTachiTargets(
  asset: VNGeneratedAssetRecord,
  targets: StageableNode[],
  knownSpeakers: Set<string>,
): ScoredTarget[] {
  const assetTokens = assetIdentityTokens(asset);
  const matches: ScoredTarget[] = [];
  let previousSpeaker = '';

  for (const target of targets) {
    if (!target.primarySpeaker || target.node.SubType !== DIALOGUE_SUBTYPE && target.node.SubType !== PARAGRAPH_SUBTYPE) {
      previousSpeaker = target.primarySpeaker || previousSpeaker;
      continue;
    }

    const speakerKey = normalizeName(target.primarySpeaker);
    const exactAssetMatch = assetTokens.has(speakerKey);
    const fuzzyAssetMatch = !exactAssetMatch && hasTokenOverlap(assetTokens, speakerKey);
    const singleKnownSpeakerFallback = knownSpeakers.size <= 1 && asset.category === 'Tachi';
    if (!exactAssetMatch && !fuzzyAssetMatch && !singleKnownSpeakerFallback) {
      previousSpeaker = target.primarySpeaker;
      continue;
    }

    let score = exactAssetMatch ? 0.96 : fuzzyAssetMatch ? 0.78 : 0.58;
    const reasons = [exactAssetMatch ? 'speaker id matches Tachi asset' : fuzzyAssetMatch ? 'speaker token matches Tachi asset' : 'single-speaker fallback'];
    if (normalizeName(previousSpeaker) !== speakerKey) {
      score += 0.08;
      reasons.push('first line after speaker change');
    }
    if (emotionScore(target.text) > 0) {
      score += 0.04;
      reasons.push('emotionally marked line');
    }

    matches.push({ target, score, reason: reasons.join('; ') });
    previousSpeaker = target.primarySpeaker;
  }

  return matches.sort(compareScoredTargets);
}

function scoreIllustrationTargets(asset: VNGeneratedAssetRecord, targets: StageableNode[]): ScoredTarget[] {
  return targets
    .filter(target => target.node.SubType !== DIALOGUE_SUBTYPE || target.text.length > 0)
    .map(target => {
      const event = eventScore(target.text);
      const assetMatch = hasTokenOverlap(assetIdentityTokens(asset), normalizeName(target.text));
      const lateBeat = target.order >= Math.max(0, targets.length - 2) ? 0.16 : 0;
      const choiceBeat = target.node.SubType === CHOICE_SUBTYPE ? 0.18 : 0;
      const score = 0.48 + event.score + lateBeat + choiceBeat + (assetMatch ? 0.08 : 0);
      const reasons = event.reasons.length > 0 ? event.reasons : ['strongest available visual beat'];
      if (lateBeat) reasons.push('late chapter beat');
      if (choiceBeat) reasons.push('choice or branch setup');
      return { target, score, reason: reasons.join('; ') };
    })
    .filter(item => item.score >= 0.5)
    .sort(compareScoredTargets);
}

function selectDistinctTargets(matches: ScoredTarget[], limit: number): ScoredTarget[] {
  const selected: ScoredTarget[] = [];
  const seen = new Set<number>();
  for (const match of matches) {
    if (seen.has(match.target.node.Index)) continue;
    selected.push(match);
    seen.add(match.target.node.Index);
    if (selected.length >= limit) break;
  }
  return selected.sort((left, right) => left.target.order - right.target.order);
}

function compareScoredTargets(left: ScoredTarget, right: ScoredTarget): number {
  return right.score - left.score || left.target.order - right.target.order;
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

function extractSpeakers(node: VNNodeSaveData): string[] {
  const speakers = new Set<string>();
  addStringValue(node.Data?.SpeakerIdData, speakers);
  const lines = node.Data?.Lines?.Items ?? [];
  for (const line of lines) addStringValue(line.ObjectValue?.SpeakerId, speakers);
  return [...speakers].filter(value => value.trim().length > 0);
}

function extractText(node: VNNodeSaveData): string {
  const parts: string[] = [];
  collectTextValue(node.Data?.TextData, parts);
  const lines = node.Data?.Lines?.Items ?? [];
  for (const line of lines) collectTextValue(line.ObjectValue?.Text, parts);
  const options = node.Data?.Options?.Items ?? [];
  for (const option of options) collectTextValue(option.ObjectValue?.Text, parts);
  return parts.join('\n');
}

function collectTextValue(value: VNSerializedValue | undefined, parts: string[]) {
  if (value?.Kind === 'String' && value.StringValue) parts.push(value.StringValue);
}

function addStringValue(value: VNSerializedValue | undefined, target: Set<string>) {
  if (value?.Kind === 'String' && value.StringValue) target.add(value.StringValue.trim());
}

function assetIdentityTokens(asset: VNGeneratedAssetRecord): Set<string> {
  return normalizeNameSet([
    asset.assetId,
    asset.scopedAssetId.replace(/^assets:/, ''),
    asset.publicUrl,
  ].flatMap(value => value.split(/[./_\\-]+/g)));
}

function normalizeNameSet(values: string[]): Set<string> {
  return new Set(values.map(normalizeName).filter(Boolean));
}

function normalizeName(value: string): string {
  return (value ?? '').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '');
}

function hasTokenOverlap(tokens: Set<string>, value: string): boolean {
  if (!value) return false;
  for (const token of tokens) {
    if (token.length >= 2 && (value.includes(token) || token.includes(value))) return true;
  }
  return false;
}

function eventScore(text: string): { score: number; reasons: string[] } {
  const checks: Array<[RegExp, number, string]> = [
    [/(reveal|truth|secret|clue|发现|真相|秘密|线索)/i, 0.24, 'reveal or discovery beat'],
    [/(choice|decide|branch|选择|决定|分歧|抉择)/i, 0.2, 'choice setup beat'],
    [/(climax|attack|battle|crash|escape|爆发|战斗|逃离|崩塌)/i, 0.22, 'climax or action beat'],
    [/(ending|farewell|aftermath|终点|告别|余波|结局)/i, 0.18, 'aftermath or terminal beat'],
  ];
  const reasons: string[] = [];
  let score = 0;
  for (const [pattern, value, reason] of checks) {
    if (pattern.test(text)) {
      score += value;
      reasons.push(reason);
    }
  }
  return { score, reasons };
}

function emotionScore(text: string): number {
  return /(惊|怒|泪|笑|fear|angry|tears|smile|shout|whisper)/i.test(text) ? 1 : 0;
}

function categoryRank(category: string): number {
  if (category === 'Tachi') return 0;
  if (category === 'Illustration') return 1;
  return 9;
}

function actionRank(kind: VNVisualPlacementActionKind): number {
  return kind === 'Illustration' ? 0 : 1;
}

function clampConfidence(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(2))));
}

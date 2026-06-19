export type GenerationMode =
  | 'proseContinuation'
  | 'vnGraphPreview'
  | 'vnGraphPersist'
  | 'vnGraphWithAssetsPreview'
  | 'imageForStorySegment'
  | 'assetForVNChapter'
  | 'aivnPackageExport';

export type GenerationAssetCategory =
  | 'Background'
  | 'Tachi'
  | 'Illustration'
  | 'Voice'
  | 'Bgm'
  | 'SoundEffect';

export type GenerationAssetGroup =
  | 'background'
  | 'tachi'
  | 'illustration'
  | 'voice'
  | 'bgm'
  | 'soundeffect';

export type VisualIntentKind =
  | 'Narration'
  | 'Dialogue'
  | 'Choice'
  | 'EventCg';

export type VisualIntentCriticality =
  | 'Normal'
  | 'Important'
  | 'Critical';

export type GenerationSeverity = 'info' | 'warning' | 'error';

const ASSET_GROUP_BY_CATEGORY: Record<GenerationAssetCategory, GenerationAssetGroup> = {
  Background: 'background',
  Tachi: 'tachi',
  Illustration: 'illustration',
  Voice: 'voice',
  Bgm: 'bgm',
  SoundEffect: 'soundeffect',
};

const ASSET_PREFIX_BY_CATEGORY: Partial<Record<GenerationAssetCategory, string>> = {
  Background: 'bg.',
  Tachi: 'char.',
  Illustration: 'cg.',
};

export interface GenerationStoryRef {
  id: string;
  title: string;
  description?: string;
  genre?: string;
  era?: string;
}

export interface GenerationChainSegment {
  id: string;
  title?: string;
  content: string;
  parentSegmentId?: string | null;
  imageUrls?: string[];
  characterIds?: string[];
}

export interface GenerationBranchContext {
  id: string;
  title?: string;
  userDirection?: string;
  sourceSegmentId?: string | null;
}

export interface GenerationEventContext {
  id?: string;
  description: string;
  importance?: number | string;
  status?: string;
}

export interface GenerationForkDialogueEntry {
  speakerId: string;
  text: string;
}

export interface GenerationForkTachiEntry {
  tachiId: string;
  image: string;
}

export interface GenerationForkContext {
  selectedOptionText?: string;
  sourceGraphPath?: string;
  currentBackgroundImage?: string;
  currentIllustrationImage?: string;
  recentDialogue?: GenerationForkDialogueEntry[];
  tachis?: GenerationForkTachiEntry[];
  variables?: Record<string, string>;
  variableDefinitions?: Record<string, string>;
  attributes?: Record<string, number>;
}

export interface GenerationCharacterEntry {
  id: string;
  displayName: string;
  canonicalName?: string;
  aliases?: string[];
  role?: string;
  speechPatterns?: string;
  appearance?: string;
  voiceCard?: string;
}

export interface GenerationCharacterTable {
  entries: GenerationCharacterEntry[];
  exactSpeakerIds: string[];
  aliasesBySpeakerId?: Record<string, string[]>;
}

export interface GenerationAssetReference {
  category: GenerationAssetCategory;
  assetId: string;
  scopedAssetId: string;
  sourceHash?: string;
  publicUrl?: string;
  localPath?: string;
  objectPath?: string;
  contentType?: string;
}

export interface GenerationAssetWhitelist {
  assetsByGroup: Partial<Record<GenerationAssetGroup, string[]>>;
}

export interface GenerationVisualState {
  backgroundAssetId?: string;
  illustrationAssetId?: string;
  tachiAssetIds?: string[];
}

export interface VisualIntent {
  id: string;
  order: number;
  kind: VisualIntentKind;
  criticality: VisualIntentCriticality;
  sourceNodeIndex?: number;
  sourceHash?: string;
  text?: string;
  speakerId?: string;
  plotBeat?: string;
  prompt?: string;
  requiredSubjects?: string[];
  backgroundAssetId?: string;
  illustrationAssetId?: string;
  tachiAssetIds?: string[];
}

export interface GenerationContext {
  mode: GenerationMode;
  story: GenerationStoryRef;
  branchId: string;
  sourceSegmentId?: string;
  chain: GenerationChainSegment[];
  branch?: GenerationBranchContext | null;
  fork?: GenerationForkContext | null;
  characters?: GenerationCharacterTable;
  summaries?: string[];
  events?: GenerationEventContext[];
  directorState?: unknown;
  assetWhitelist?: GenerationAssetWhitelist;
  visualState?: GenerationVisualState;
}

export interface GenerationIssue {
  severity: GenerationSeverity;
  code: string;
  message: string;
  path?: string;
}

export interface GenerationValidationReport {
  valid: boolean;
  requireEndingTerminal?: boolean;
  issues: GenerationIssue[];
}

export interface GenerationRunReport {
  runId: string;
  mode: GenerationMode;
  success: boolean;
  startedAt: string;
  completedAt?: string;
  sourceHash?: string;
  validation?: GenerationValidationReport;
  visualIntents?: VisualIntent[];
  assetWhitelist?: GenerationAssetWhitelist;
  warnings: GenerationIssue[];
  errors: GenerationIssue[];
}

export function getAssetGroup(category: GenerationAssetCategory): GenerationAssetGroup {
  return ASSET_GROUP_BY_CATEGORY[category];
}

export function getRequiredAssetIdPrefix(category: GenerationAssetCategory): string {
  return ASSET_PREFIX_BY_CATEGORY[category] ?? '';
}

export function normalizeScopedAssetId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';

  const withoutScope = trimmed.startsWith('assets:')
    ? trimmed.slice('assets:'.length)
    : trimmed;

  return `assets:${withoutScope.trim().toLowerCase()}`;
}

export function isValidGeneratedAssetId(
  category: GenerationAssetCategory,
  scopedAssetId: string,
): boolean {
  const prefix = getRequiredAssetIdPrefix(category);
  if (!prefix) return true;

  const normalized = normalizeScopedAssetId(scopedAssetId);
  return normalized.startsWith(`assets:${prefix}`);
}

export function createAssetWhitelist(
  assets: GenerationAssetReference[] = [],
): GenerationAssetWhitelist {
  const whitelist: GenerationAssetWhitelist = { assetsByGroup: {} };
  for (const asset of assets) {
    addAssetToWhitelist(whitelist, asset.category, asset.scopedAssetId);
  }
  return whitelist;
}

export function addAssetToWhitelist(
  whitelist: GenerationAssetWhitelist,
  category: GenerationAssetCategory,
  scopedAssetId: string,
): GenerationAssetWhitelist {
  const normalized = normalizeScopedAssetId(scopedAssetId);
  if (!normalized) return whitelist;

  const group = getAssetGroup(category);
  const current = whitelist.assetsByGroup[group] ?? [];
  if (!current.includes(normalized)) {
    whitelist.assetsByGroup[group] = [...current, normalized].sort();
  }

  return whitelist;
}

export function whitelistContains(
  whitelist: GenerationAssetWhitelist | undefined,
  category: GenerationAssetCategory,
  scopedAssetId: string,
): boolean {
  if (!whitelist) return false;

  const group = getAssetGroup(category);
  const normalized = normalizeScopedAssetId(scopedAssetId);
  return Boolean(whitelist.assetsByGroup[group]?.includes(normalized));
}

export function createGenerationRunReport(options: {
  runId: string;
  mode: GenerationMode;
  success?: boolean;
  startedAt?: string;
  completedAt?: string;
  sourceHash?: string;
  validation?: GenerationValidationReport;
  visualIntents?: VisualIntent[];
  assetWhitelist?: GenerationAssetWhitelist;
  issues?: GenerationIssue[];
}): GenerationRunReport {
  const issues = options.issues ?? [];
  return {
    runId: options.runId,
    mode: options.mode,
    success: options.success ?? false,
    startedAt: options.startedAt ?? new Date(0).toISOString(),
    completedAt: options.completedAt,
    sourceHash: options.sourceHash,
    validation: options.validation,
    visualIntents: options.visualIntents ?? [],
    assetWhitelist: options.assetWhitelist,
    warnings: issues.filter(issue => issue.severity === 'warning'),
    errors: issues.filter(issue => issue.severity === 'error'),
  };
}

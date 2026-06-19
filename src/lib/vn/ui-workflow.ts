export const AIVN_ASSET_CATEGORIES = ['Background', 'Tachi', 'Illustration'] as const;

export type AIVNAssetCategory = typeof AIVN_ASSET_CATEGORIES[number];
export type AIVNExportFormat = 'aivn-folder' | 'aivn-zip' | 'folder' | 'zip';

export interface AIVNGenerateRequestOptions {
  branchId: string;
  persist: boolean;
  sourceSegmentId?: string | null;
  includeDebug?: boolean;
  includeGeneratedAssets?: boolean;
  requireEndingTerminal?: boolean;
  maxRepairAttempts?: number;
  chapterId?: string | null;
}

export interface AIVNValidationLike {
  valid?: boolean;
  error?: string | null;
  issues?: unknown[] | null;
}

export interface AIVNValidationSummary {
  tone: 'ok' | 'warn' | 'error' | 'idle';
  label: string;
  detail: string;
}

export const VN_ASSET_WORKFLOW_OPTIONS: Array<{
  category: AIVNAssetCategory;
  label: string;
  description: string;
  graphBehavior: string;
}> = [
  {
    category: 'Background',
    label: '背景',
    description: '生成场景背景；成功后写入 Start.BackgroundImage 并重新验证 graph。',
    graphBehavior: '自动写入 graph',
  },
  {
    category: 'Tachi',
    label: '立绘',
    description: '生成角色立绘；成功后自动挂到 Dialogue/Paragraph 节点 Actions 演出。',
    graphBehavior: '自动编排节点',
  },
  {
    category: 'Illustration',
    label: '插画',
    description: '生成事件插画；成功后自动挂到 Dialogue/Paragraph 节点 Actions 演出。',
    graphBehavior: '自动编排节点',
  },
];

export function buildAIVNGenerateEndpoint(storyId: string): string {
  return `/api/stories/${encodeURIComponent(storyId)}/aivn-generate`;
}

export function buildVNChapterAssetsEndpoint(storyId: string, chapterId: string): string {
  return `/api/stories/${encodeURIComponent(storyId)}/vn-chapters/${encodeURIComponent(chapterId)}/assets`;
}

export function buildVNChapterExportEndpoint(
  storyId: string,
  chapterId: string,
  format: AIVNExportFormat,
): string {
  return `/api/stories/${encodeURIComponent(storyId)}/vn-chapters/${encodeURIComponent(chapterId)}/export?format=${encodeURIComponent(format)}`;
}

export function buildAIVNGenerateRequest(options: AIVNGenerateRequestOptions) {
  const maxRepairAttempts = Math.max(0, Math.min(options.maxRepairAttempts ?? 1, 2));
  return {
    branchId: options.branchId || 'main',
    sourceSegmentId: options.sourceSegmentId || undefined,
    persist: options.persist,
    includeDebug: !!options.includeDebug,
    includeGeneratedAssets: options.includeGeneratedAssets ?? true,
    requireEndingTerminal: options.requireEndingTerminal ?? true,
    maxRepairAttempts,
    chapterId: options.chapterId || undefined,
  };
}

export function summarizeAIVNValidation(validation?: AIVNValidationLike | null): AIVNValidationSummary {
  if (!validation) {
    return { tone: 'idle', label: '尚未预览', detail: '' };
  }

  if (validation.valid) {
    const issueCount = validation.issues?.length || 0;
    return {
      tone: issueCount > 0 ? 'warn' : 'ok',
      label: issueCount > 0 ? '验证通过，有提示' : '验证通过',
      detail: issueCount > 0 ? `${issueCount} issue(s)` : '',
    };
  }

  return {
    tone: 'error',
    label: '验证失败',
    detail: validation.error || '',
  };
}

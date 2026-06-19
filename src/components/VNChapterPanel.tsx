'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  VN_ASSET_WORKFLOW_OPTIONS,
  buildAIVNGenerateEndpoint,
  buildAIVNGenerateRequest,
  buildVNChapterAssetsEndpoint,
  buildVNChapterExportEndpoint,
  summarizeAIVNValidation,
  type AIVNAssetCategory,
} from '@/lib/vn/ui-workflow';

interface VNChapterSummary {
  id: string;
  branchId: string;
  sourceSegmentId?: string | null;
  status: string;
  validationError?: string | null;
  repairAttempts: number;
  migrationKind?: string | null;
  sourceHash?: string | null;
  createdAt: string;
}

interface VNAssetSummary {
  id: string;
  assetId: string;
  scopedAssetId: string;
  category: AIVNAssetCategory | string;
  publicUrl: string;
  mimeType?: string | null;
  sha256?: string | null;
  prompt?: string | null;
  createdAt: string;
}

interface FusedPreview {
  success?: boolean;
  mode?: string;
  chapter?: { id?: string } | null;
  graph?: unknown;
  validation?: {
    valid?: boolean;
    error?: string;
    issues?: unknown[];
  } | null;
  repairAttempts?: number;
  contextSummary?: Record<string, unknown>;
}

interface VNChapterPanelProps {
  storyId: string;
  branchId: string;
  isOpen: boolean;
  onClose: () => void;
}

type GenerationMode = 'preview' | 'persist' | null;

export default function VNChapterPanel({ storyId, branchId, isOpen, onClose }: VNChapterPanelProps) {
  const [chapters, setChapters] = useState<VNChapterSummary[]>([]);
  const [assetsByChapter, setAssetsByChapter] = useState<Record<string, VNAssetSummary[]>>({});
  const [loading, setLoading] = useState(false);
  const [generationMode, setGenerationMode] = useState<GenerationMode>(null);
  const [assetBusy, setAssetBusy] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<FusedPreview | null>(null);

  const latestChapter = chapters[0] ?? null;
  const previewValidation = useMemo(
    () => summarizeAIVNValidation(preview?.validation),
    [preview],
  );

  useEffect(() => {
    if (isOpen) void loadChapters();
  }, [isOpen, storyId, branchId]);

  if (!isOpen) return null;

  async function loadChapters() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/stories/${storyId}/vn-chapters?branchId=${encodeURIComponent(branchId)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'VN chapter list failed');

      const loadedChapters = (data.chapters || []) as VNChapterSummary[];
      setChapters(loadedChapters);
      await Promise.all(loadedChapters.slice(0, 8).map(chapter => loadAssetsForChapter(chapter.id, true)));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'VN chapter list failed');
    } finally {
      setLoading(false);
    }
  }

  async function loadAssetsForChapter(chapterId: string, silent = false) {
    if (!silent) setError('');
    try {
      const res = await fetch(buildVNChapterAssetsEndpoint(storyId, chapterId));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'asset list failed');
      setAssetsByChapter(previous => ({
        ...previous,
        [chapterId]: data.assets || [],
      }));
    } catch (e) {
      if (!silent) setError(e instanceof Error ? e.message : 'asset list failed');
    }
  }

  async function runFusedGeneration(persist: boolean) {
    setGenerationMode(persist ? 'persist' : 'preview');
    setError('');
    setMessage('');
    setFolderPath('');
    try {
      const res = await fetch(buildAIVNGenerateEndpoint(storyId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildAIVNGenerateRequest({
          branchId,
          persist,
          includeDebug: false,
          includeGeneratedAssets: true,
          requireEndingTerminal: true,
          maxRepairAttempts: 1,
        })),
      });
      const data = await res.json();
      setPreview(data);
      if (!res.ok || !data.success) {
        throw new Error(data.validation?.error || data.error || 'fused AIVN generation failed');
      }

      if (persist) {
        setMessage(`已保存 fused AIVN chapter：${data.chapter?.id || ''}`);
        await loadChapters();
      } else {
        setMessage('fused AIVN 预览通过验证，可以保存为 VN chapter');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'fused AIVN generation failed');
    } finally {
      setGenerationMode(null);
    }
  }

  async function generateAsset(chapterId: string, category: AIVNAssetCategory) {
    const busyKey = `${chapterId}:${category}`;
    setAssetBusy(busyKey);
    setError('');
    setMessage('');
    setFolderPath('');
    try {
      const res = await fetch(buildVNChapterAssetsEndpoint(storyId, chapterId), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category, style: 'auto' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.warning || data.error || `${category} asset generation failed`);
      }

      const graphNote = data.graphChanged ? '，已写入并重新验证 graph' : '，已进入资产清单';
      setMessage(`已生成 ${category}：${data.asset?.scopedAssetId || ''}${graphNote}`);
      await loadAssetsForChapter(chapterId, true);
    } catch (e) {
      setError(e instanceof Error ? e.message : `${category} asset generation failed`);
    } finally {
      setAssetBusy(null);
    }
  }

  async function exportAIVNFolder(chapterId: string) {
    setError('');
    setMessage('');
    setFolderPath('');
    try {
      const res = await fetch(buildVNChapterExportEndpoint(storyId, chapterId, 'aivn-folder'));
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || 'AIVN folder export failed');
      setFolderPath(data.folderPath || '');
      setMessage(`AIVN installable package 导出完成：${data.packageId || ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'AIVN folder export failed');
    }
  }

  function downloadAIVNZip(chapterId: string) {
    window.location.href = buildVNChapterExportEndpoint(storyId, chapterId, 'aivn-zip');
  }

  function formatHash(hash?: string | null) {
    if (!hash) return '';
    return hash.length > 16 ? `${hash.slice(0, 10)}...${hash.slice(-6)}` : hash;
  }

  function assetCount(chapterId: string, category: AIVNAssetCategory) {
    return (assetsByChapter[chapterId] || []).filter(asset => asset.category === category).length;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-4xl rounded-lg border border-[var(--border)] bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--ink)]">AIVN fused VN chapter</h3>
            <p className="text-xs text-[var(--muted)]">branch: {branchId}</p>
            <p className="mt-1 text-xs text-[var(--muted)]">
              服务器生成 AIVN-compatible graph 和资产包，本地 AIVN/Godot 负责导入加载。
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:bg-gray-100">关闭</button>
        </div>

        <div className="mb-4 grid gap-3 rounded-lg border border-[var(--border)] bg-gray-50 p-3 md:grid-cols-[1fr_auto]">
          <div>
            <div className="text-sm font-semibold text-[var(--ink)]">fused generation</div>
            <div className="mt-1 text-xs text-[var(--muted)]">
              使用 strict AIVN prompt、角色白名单、资产白名单、terminal End 校验；不会改写原始 Story/Segment/Branch。
            </div>
            {preview && (
              <div className={`mt-2 rounded-md border px-3 py-2 text-xs ${
                previewValidation.tone === 'ok'
                  ? 'border-green-200 bg-green-50 text-green-700'
                  : previewValidation.tone === 'warn'
                    ? 'border-yellow-200 bg-yellow-50 text-yellow-700'
                    : 'border-red-200 bg-red-50 text-red-700'
              }`}>
                {previewValidation.label}
                {previewValidation.detail && <span className="ml-2">{previewValidation.detail}</span>}
                {typeof preview.repairAttempts === 'number' && <span className="ml-2">repair {preview.repairAttempts}</span>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-start gap-2 md:justify-end">
            <button
              onClick={() => runFusedGeneration(false)}
              disabled={generationMode !== null}
              className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm text-[var(--ink)] hover:bg-gray-50 disabled:cursor-wait disabled:text-gray-400"
            >
              {generationMode === 'preview' ? '预览中...' : '预览 fused graph'}
            </button>
            <button
              onClick={() => runFusedGeneration(true)}
              disabled={generationMode !== null}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:bg-gray-300"
            >
              {generationMode === 'persist' ? '保存中...' : '生成并保存'}
            </button>
            <button
              onClick={loadChapters}
              disabled={loading}
              className="rounded-lg border border-[var(--border)] bg-white px-4 py-2 text-sm text-[var(--ink)] hover:bg-gray-50 disabled:cursor-wait"
            >
              {loading ? '刷新中...' : '刷新'}
            </button>
          </div>
        </div>

        {message && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>}
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {folderPath && <div className="mb-3 break-all rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700">{folderPath}</div>}

        {latestChapter && (
          <div className="mb-3 rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            最新 chapter: <span className="font-medium">{latestChapter.id}</span>
            {latestChapter.migrationKind && <span className="ml-2">{latestChapter.migrationKind}</span>}
          </div>
        )}

        <div className="max-h-[58vh] space-y-3 overflow-y-auto">
          {chapters.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
              还没有 VN chapter。先预览 fused graph，通过后保存。
            </div>
          )}
          {chapters.map((chapter) => {
            const assets = assetsByChapter[chapter.id] || [];
            const valid = chapter.status === 'valid';
            return (
              <div key={chapter.id} className="rounded-lg border border-[var(--border)] p-4">
                <div className="mb-3 flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-[var(--ink)]">{chapter.id}</div>
                    <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                      <span className={valid ? 'text-green-700' : 'text-red-600'}>{chapter.status}</span>
                      <span>repair {chapter.repairAttempts}</span>
                      {chapter.migrationKind && <span>{chapter.migrationKind}</span>}
                      {chapter.sourceHash && <span title={chapter.sourceHash}>{formatHash(chapter.sourceHash)}</span>}
                      <span>{new Date(chapter.createdAt).toLocaleString()}</span>
                    </div>
                    {chapter.validationError && (
                      <div className="mt-2 text-xs text-red-600">{chapter.validationError}</div>
                    )}
                  </div>
                  <button
                    onClick={() => loadAssetsForChapter(chapter.id)}
                    className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs text-[var(--muted)] hover:bg-gray-50"
                  >
                    刷新资产
                  </button>
                </div>

                <div className="mb-3 grid gap-2 md:grid-cols-3">
                  {VN_ASSET_WORKFLOW_OPTIONS.map(option => {
                    const busy = assetBusy === `${chapter.id}:${option.category}`;
                    return (
                      <button
                        key={option.category}
                        onClick={() => generateAsset(chapter.id, option.category)}
                        disabled={busy || !valid}
                        className="rounded-lg border border-[var(--border)] px-3 py-2 text-left text-xs hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                        title={option.description}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-[var(--ink)]">{option.label}</span>
                          <span className="rounded-full bg-gray-100 px-2 py-0.5 text-[10px] text-[var(--muted)]">
                            {assetCount(chapter.id, option.category)}
                          </span>
                        </div>
                        <div className="mt-1 text-[11px] text-[var(--muted)]">
                          {busy ? '生成中...' : option.graphBehavior}
                        </div>
                      </button>
                    );
                  })}
                </div>

                {assets.length > 0 && (
                  <div className="mb-3 rounded-lg bg-gray-50 p-3">
                    <div className="mb-2 text-xs font-semibold text-[var(--ink)]">已生成资产</div>
                    <div className="space-y-1">
                      {assets.map(asset => (
                        <div key={asset.id} className="flex items-center justify-between gap-2 text-xs">
                          <div className="min-w-0">
                            <span className="mr-2 rounded bg-white px-1.5 py-0.5 text-[10px] text-[var(--muted)]">{asset.category}</span>
                            <span className="break-all text-[var(--ink)]">{asset.scopedAssetId}</span>
                          </div>
                          {asset.sha256 && <span className="shrink-0 text-[10px] text-[var(--muted)]" title={asset.sha256}>{formatHash(asset.sha256)}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={() => exportAIVNFolder(chapter.id)}
                    disabled={!valid}
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                  >
                    导出 AIVN 文件夹
                  </button>
                  <button
                    onClick={() => downloadAIVNZip(chapter.id)}
                    disabled={!valid}
                    className="rounded-lg bg-[var(--gold)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90 disabled:cursor-not-allowed disabled:bg-gray-300"
                  >
                    下载 AIVN zip
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

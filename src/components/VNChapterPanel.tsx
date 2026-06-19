'use client';

import { useEffect, useState } from 'react';

interface VNChapterSummary {
  id: string;
  branchId: string;
  sourceSegmentId?: string | null;
  status: string;
  validationError?: string | null;
  repairAttempts: number;
  createdAt: string;
}

interface VNChapterPanelProps {
  storyId: string;
  branchId: string;
  isOpen: boolean;
  onClose: () => void;
}

export default function VNChapterPanel({ storyId, branchId, isOpen, onClose }: VNChapterPanelProps) {
  const [chapters, setChapters] = useState<VNChapterSummary[]>([]);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [assetBusy, setAssetBusy] = useState<string | null>(null);
  const [folderPath, setFolderPath] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    if (isOpen) void loadChapters();
  }, [isOpen, storyId, branchId]);

  if (!isOpen) return null;

  async function loadChapters() {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`/api/stories/${storyId}/vn-chapters?branchId=${branchId}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'VN章节加载失败');
      setChapters(data.chapters || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'VN章节加载失败');
    } finally {
      setLoading(false);
    }
  }

  async function generateChapter() {
    setGenerating(true);
    setError('');
    setMessage('');
    setFolderPath('');
    try {
      const res = await fetch(`/api/stories/${storyId}/vn-continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          persist: true,
          requireEndingTerminal: true,
          maxRepairAttempts: 1,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.validation?.error || data.error || 'VNGraph生成失败');
      }
      setMessage(`已生成 VN chapter：${data.chapter?.id || ''}`);
      await loadChapters();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'VNGraph生成失败');
    } finally {
      setGenerating(false);
    }
  }

  async function generateBackground(chapterId: string) {
    setAssetBusy(chapterId);
    setError('');
    setMessage('');
    try {
      const res = await fetch(`/api/stories/${storyId}/vn-chapters/${chapterId}/assets`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ category: 'Background', style: 'auto' }),
      });
      const data = await res.json();
      if (!res.ok || !data.success) {
        throw new Error(data.warning || data.error || '背景资产生成失败');
      }
      setMessage(`已绑定背景资产：${data.asset?.scopedAssetId || ''}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : '背景资产生成失败');
    } finally {
      setAssetBusy(null);
    }
  }

  async function exportFolder(chapterId: string) {
    setError('');
    setMessage('');
    setFolderPath('');
    try {
      const res = await fetch(`/api/stories/${storyId}/vn-chapters/${chapterId}/export?format=folder`);
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || '文件夹导出失败');
      setFolderPath(data.folderPath || '');
      setMessage('文件夹导出完成');
    } catch (e) {
      setError(e instanceof Error ? e.message : '文件夹导出失败');
    }
  }

  function downloadZip(chapterId: string) {
    window.location.href = `/api/stories/${storyId}/vn-chapters/${chapterId}/export?format=zip`;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl rounded-lg border border-[var(--border)] bg-white p-5 shadow-xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-3">
          <div>
            <h3 className="text-lg font-bold text-[var(--ink)]">VN 章节</h3>
            <p className="text-xs text-[var(--muted)]">当前分支：{branchId}</p>
          </div>
          <button onClick={onClose} className="rounded-lg px-2 py-1 text-sm text-[var(--muted)] hover:bg-gray-100">关闭</button>
        </div>

        <div className="mb-4 flex flex-wrap gap-2">
          <button
            onClick={generateChapter}
            disabled={generating}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm font-medium text-white disabled:cursor-wait disabled:bg-gray-300"
          >
            {generating ? '生成中...' : '生成并保存 VNGraph'}
          </button>
          <button
            onClick={loadChapters}
            disabled={loading}
            className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--ink)] hover:bg-gray-50 disabled:cursor-wait"
          >
            {loading ? '刷新中...' : '刷新列表'}
          </button>
        </div>

        {message && <div className="mb-3 rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-700">{message}</div>}
        {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        {folderPath && <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-700 break-all">{folderPath}</div>}

        <div className="max-h-[55vh] space-y-3 overflow-y-auto">
          {chapters.length === 0 && (
            <div className="rounded-lg border border-dashed border-[var(--border)] p-4 text-sm text-[var(--muted)]">
              还没有 VN chapter。
            </div>
          )}
          {chapters.map((chapter) => (
            <div key={chapter.id} className="rounded-lg border border-[var(--border)] p-4">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-[var(--ink)]">{chapter.id}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-[var(--muted)]">
                    <span>{chapter.status}</span>
                    <span>repair {chapter.repairAttempts}</span>
                    <span>{new Date(chapter.createdAt).toLocaleString()}</span>
                  </div>
                  {chapter.validationError && (
                    <div className="mt-2 text-xs text-red-600">{chapter.validationError}</div>
                  )}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => generateBackground(chapter.id)}
                  disabled={assetBusy === chapter.id || chapter.status !== 'valid'}
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-gray-50 disabled:cursor-not-allowed disabled:text-gray-400"
                >
                  {assetBusy === chapter.id ? '生成背景中...' : '生成背景'}
                </button>
                <button onClick={() => exportFolder(chapter.id)} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--ink)] hover:bg-gray-50">
                  导出文件夹
                </button>
                <button onClick={() => downloadZip(chapter.id)} className="rounded-lg bg-[var(--gold)] px-3 py-1.5 text-xs font-medium text-white hover:opacity-90">
                  下载 zip
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

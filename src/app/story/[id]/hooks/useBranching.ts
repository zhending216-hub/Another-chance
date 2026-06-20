'use client';

import { useState } from 'react';
import { getStaticBranchDirections } from '@/lib/genre-config';
import type { Character, StoryBranch } from '@/types/story';

interface SuggestedDirection {
  icon: string;
  label: string;
  desc: string;
}

interface UseBranchingOptions {
  storyId: string;
  currentBranchId: string;
  branches: StoryBranch[];
  storyGenre?: string;
  setCurrentBranchId: (branchId: string) => void;
  loadTree: () => Promise<void>;
  loadBranchSegments: (branchId: string) => Promise<void>;
}

export function useBranching({
  storyId,
  currentBranchId,
  branches,
  storyGenre,
  setCurrentBranchId,
  loadTree,
  loadBranchSegments,
}: UseBranchingOptions) {
  const [showBranchDialog, setShowBranchDialog] = useState(false);
  const [branchingSegmentId, setBranchingSegmentId] = useState<string | null>(null);
  const [userDirection, setUserDirection] = useState('');
  const [customDirection, setCustomDirection] = useState('');
  const [branching, setBranching] = useState(false);
  const [branchStep, setBranchStep] = useState('');
  const [branchPreview, setBranchPreview] = useState('');
  const [suggestedDirections, setSuggestedDirections] = useState<SuggestedDirection[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);

  const handleBranch = async (segmentId: string) => {
    setBranchingSegmentId(segmentId);
    setUserDirection('');
    setCustomDirection('');

    try {
      const charRes = await fetch(`/api/stories/${storyId}/characters`);
      let chars: Array<{ name: string; role: string }> = [];
      if (charRes.ok) {
        const raw = await charRes.json();
        const arr: Character[] = Array.isArray(raw) ? raw : (raw.characters || []);
        chars = arr.map(c => ({ name: c.name, role: c.role }));
      }
      setSuggestedDirections(getStaticBranchDirections(storyGenre, chars));
    } catch {
      setSuggestedDirections(getStaticBranchDirections('', []));
    }
    setShowBranchDialog(true);

    setSuggestionsLoading(true);
    try {
      const res = await fetch(`/api/stories/${storyId}/branch-suggestions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, branchId: currentBranchId }),
      });
      if (res.ok) {
        const data = await res.json();
        if (data.suggestions?.length > 0) {
          setSuggestedDirections(data.suggestions);
        }
      }
    } catch {
      // 静默失败，静态方向保持展示
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const confirmBranch = async () => {
    if (!branchingSegmentId) return;
    const direction = customDirection.trim() || userDirection;
    if (!direction) {
      alert('请选择或输入分叉方向');
      return;
    }

    setBranching(true);
    setBranchStep('thinking');
    setBranchPreview('');

    try {
      await new Promise(r => setTimeout(r, 800));
      setBranchStep('generating');

      const res = await fetch(`/api/stories/${storyId}/branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          segmentId: branchingSegmentId,
          userDirection: direction,
          visibility: (document.getElementById('fork-visibility') as HTMLSelectElement)?.value || 'PRIVATE',
          model: (document.getElementById('fork-model') as HTMLSelectElement)?.value || undefined,
        }),
      });
      if (!res.ok) throw new Error('分叉失败');

      const data = await res.json();
      setBranchStep('saving');
      setBranchPreview(data.segment?.content || '分叉剧情已生成');
      await new Promise(r => setTimeout(r, 500));

      if (data.branch?.id) {
        setCurrentBranchId(data.branch.id);
      }
      await loadTree();
      setShowBranchDialog(false);
      setBranchingSegmentId(null);
    } catch (e) {
      alert('分叉失败: ' + (e instanceof Error ? e.message : '请重试'));
    } finally {
      setBranching(false);
      setBranchStep('');
      setBranchPreview('');
    }
  };

  const switchBranch = async (branchId: string) => {
    setCurrentBranchId(branchId);
  };

  const handleDeleteBranch = async (branchId: string, branchLabel: string) => {
    if (branchId === 'main') return;
    const ok = confirm(`确定要删除分支「${branchLabel}」吗？\n该分支下的所有段落（包括从此分支再分叉的子分支）都将被永久删除，无法恢复。`);
    if (!ok) return;

    try {
      const res = await fetch(`/api/stories/${storyId}/branch/${branchId}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || '删除失败');
      }

      if (currentBranchId === branchId) {
        setCurrentBranchId('main');
      }
      await loadTree();
      await loadBranchSegments(currentBranchId === branchId ? 'main' : currentBranchId);
    } catch (e) {
      alert('删除分支失败: ' + (e instanceof Error ? e.message : '请重试'));
    }
  };

  const getCurrentBranchPath = () => {
    if (currentBranchId === 'main') return ['主线'];
    const branch = branches.find(b => b.id === currentBranchId);
    return branch ? [branch.userDirection || branch.title] : [currentBranchId];
  };

  const getBranchCountForSegment = (segmentId: string) => {
    return branches.filter(b => b.sourceSegmentId === segmentId).length;
  };

  return {
    showBranchDialog,
    setShowBranchDialog,
    userDirection,
    setUserDirection,
    customDirection,
    setCustomDirection,
    branching,
    branchStep,
    branchPreview,
    suggestedDirections,
    suggestionsLoading,
    handleBranch,
    confirmBranch,
    switchBranch,
    handleDeleteBranch,
    getCurrentBranchPath,
    getBranchCountForSegment,
  };
}

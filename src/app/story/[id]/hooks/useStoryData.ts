'use client';

import { useCallback, useEffect, useState } from 'react';
import type { StoryBranch, StorySegment } from '@/types/story';

export interface Story {
  id: string;
  title: string;
  description?: string;
  author?: string;
  era?: string;
  genre?: string;
  characterIds?: string[];
  visibility?: string;
  ownerId?: string;
  likeCount?: number;
  isLiked?: boolean;
  coverImageUrl?: string;
}

export interface StoryEditForm {
  title: string;
  description: string;
  genre: string;
  era: string;
  author: string;
  visibility: string;
}

function buildEditForm(story: Story): StoryEditForm {
  return {
    title: story.title || '',
    description: story.description || '',
    genre: story.genre || '',
    era: story.era || '',
    author: story.author || '',
    visibility: story.visibility || 'PRIVATE',
  };
}

export function useStoryData(storyId: string) {
  const [story, setStory] = useState<Story | null>(null);
  const [segments, setSegments] = useState<StorySegment[]>([]);
  const [branches, setBranches] = useState<StoryBranch[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [currentBranchId, setCurrentBranchId] = useState('main');
  const [editForm, setEditForm] = useState<StoryEditForm>({
    title: '',
    description: '',
    genre: '',
    era: '',
    author: '',
    visibility: 'PRIVATE',
  });

  const loadBranchSegments = useCallback(async (branchId: string) => {
    const segRes = await fetch(`/api/stories/${storyId}/segments?branchId=${branchId}`);
    if (segRes.ok) {
      const segData = await segRes.json();
      setSegments(segData.segments || []);
    }
  }, [storyId]);

  const loadTree = useCallback(async () => {
    const treeRes = await fetch(`/api/stories/${storyId}/tree`);
    if (treeRes.ok) {
      const treeData = await treeRes.json();
      setBranches(treeData.branches || []);
    }
  }, [storyId]);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [sRes, treeRes] = await Promise.all([
          fetch(`/api/stories/${storyId}`),
          fetch(`/api/stories/${storyId}/tree`),
        ]);
        if (!sRes.ok || !treeRes.ok) throw new Error('加载失败');

        const sData = await sRes.json();
        const treeData = await treeRes.json();
        if (cancelled) return;

        setStory(sData.story);
        setEditForm(buildEditForm(sData.story));
        setBranches(treeData.branches || []);
        setCurrentBranchId('main');
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : '未知错误');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => { cancelled = true; };
  }, [storyId]);

  useEffect(() => {
    if (!loading) loadBranchSegments(currentBranchId);
  }, [currentBranchId, loading, loadBranchSegments]);

  return {
    story,
    setStory,
    segments,
    branches,
    loading,
    error,
    currentBranchId,
    setCurrentBranchId,
    editForm,
    setEditForm,
    loadBranchSegments,
    loadTree,
  };
}

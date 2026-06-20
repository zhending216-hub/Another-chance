'use client';

import { useEffect, useRef, useState } from 'react';
import type { PacingConfig } from '@/types/story';

interface UseStoryContinuationOptions {
  storyId: string;
  branchId: string;
  loadBranchSegments: (branchId: string) => Promise<void>;
  loadTree: () => Promise<void>;
}

export function useStoryContinuation({
  storyId,
  branchId,
  loadBranchSegments,
  loadTree,
}: UseStoryContinuationOptions) {
  const [continuing, setContinuing] = useState(false);
  const [newContent, setNewContent] = useState('');
  const [pacingConfig, setPacingConfig] = useState<PacingConfig>({ pace: 'detailed', maxLinesPerStep: 5 });
  const [isPaused, setIsPaused] = useState(false);
  const [displayedLines, setDisplayedLines] = useState<string[]>([]);
  const [lineStep, setLineStep] = useState(0);
  const [showPlausibility, setShowPlausibility] = useState(false);
  const [plausibilityReport, setPlausibilityReport] = useState<any>(null);
  const [checkingPlausibility, setCheckingPlausibility] = useState(false);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  useEffect(() => {
    if (!newContent) {
      setDisplayedLines([]);
      setLineStep(0);
      return;
    }

    const lines = newContent.split('\n').filter(l => l.trim());
    setDisplayedLines(lines);
    const max = pacingConfig.maxLinesPerStep || 5;
    if (!isPaused) {
      setLineStep(Math.min(lines.length, max));
    }
  }, [newContent, isPaused, pacingConfig.maxLinesPerStep]);

  const advanceLines = () => {
    const max = pacingConfig.maxLinesPerStep || 5;
    setLineStep(prev => Math.min(prev + max, displayedLines.length));
  };

  const handlePause = () => setIsPaused(true);
  const handleResume = () => {
    setIsPaused(false);
    const max = pacingConfig.maxLinesPerStep || 5;
    setLineStep(prev => Math.min(prev + max, displayedLines.length));
  };

  const handleContinue = async () => {
    if (continuing) return;
    setContinuing(true);
    setNewContent('');
    setLineStep(0);
    setIsPaused(false);

    try {
      const res = await fetch(`/api/stories/${storyId}/stream-continue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          branchId,
          pacingConfig,
        }),
      });

      if (!res.ok) throw new Error('续写失败');
      const reader = res.body?.getReader();
      readerRef.current = reader || null;
      const decoder = new TextDecoder();
      let full = '';

      while (reader) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        for (const line of chunk.split('\n')) {
          if (line.startsWith('data: ')) {
            const data = line.slice(6);
            if (data === '[DONE]') break;
            try {
              const parsed = JSON.parse(data);
              if (parsed.content && parsed.type !== 'line') {
                full += parsed.content;
                setNewContent(full);
              }
              if (parsed.type === 'pause') {
                setIsPaused(true);
              }
              if (parsed.type === 'error' && parsed.message) {
                alert(parsed.message);
                await loadBranchSegments(branchId);
                return;
              }
            } catch {}
          }
        }
      }

      await loadBranchSegments(branchId);
      await loadTree();
      setNewContent('');
      setDisplayedLines([]);

      const latestSegments = await fetch(`/api/stories/${storyId}/segments?branchId=${branchId}`).then(r => r.json());
      const latestSegment = latestSegments.segments?.[latestSegments.segments.length - 1];
      if (latestSegment) {
        setCheckingPlausibility(true);
        try {
          const checkRes = await fetch(`/api/stories/${storyId}/plausibility`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ segmentId: latestSegment.id, branchId }),
          });
          if (checkRes.ok) {
            const checkData = await checkRes.json();
            setPlausibilityReport(checkData.report);
            if (checkData.report?.issues?.length > 0) {
              setShowPlausibility(true);
            }
          }
        } catch (e) {
          console.warn('合理性检测失败:', e);
        } finally {
          setCheckingPlausibility(false);
        }
      }
    } catch (e) {
      alert('续写失败: ' + (e instanceof Error ? e.message : '请重试'));
    } finally {
      setContinuing(false);
      readerRef.current = null;
    }
  };

  return {
    continuing,
    newContent,
    displayedLines,
    lineStep,
    pacingConfig,
    setPacingConfig,
    isPaused,
    handlePause,
    handleResume,
    advanceLines,
    handleContinue,
    checkingPlausibility,
    plausibilityReport,
    showPlausibility,
    setShowPlausibility,
  };
}

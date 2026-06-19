'use client';

import { useState, useCallback, useRef } from 'react';

interface AutoContinueProps {
  storyId: string;
  branchId?: string;
  onComplete?: () => void;
  onProgress?: (current: number, total: number) => void;
  onSegment?: (segment: { id: string; title: string; content: string }) => void;
}

interface AutoContinueState {
  isRunning: boolean;
  current: number;
  total: number;
  lastSegment: { id: string; title: string; content: string } | null;
  warnings: string[];
  error: string | null;
}

interface AutoContinueOptions {
  targetSegments: number;
  pacingConfig?: {
    pace?: 'rush' | 'detailed' | 'pause' | 'summary';
    mood?: 'tense' | 'relaxed' | 'mysterious' | 'romantic';
  };
  segmentDelay?: number;
  pauseOnWarning?: boolean;
}

/**
 * 自动续写 Hook
 *
 * @example
 * const { start, stop, state } = useAutoContinue({
 *   storyId: 'story-123',
 *   branchId: 'main',
 *   onComplete: () => router.refresh(),
 * });
 *
 * // 开始续写 100 段
 * start({ targetSegments: 100 });
 */
export function useAutoContinue({
  storyId,
  branchId = 'main',
  onComplete,
  onProgress,
  onSegment,
}: AutoContinueProps) {
  const [state, setState] = useState<AutoContinueState>({
    isRunning: false,
    current: 0,
    total: 0,
    lastSegment: null,
    warnings: [],
    error: null,
  });

  const eventSourceRef = useRef<EventSource | null>(null);

  const start = useCallback((options: AutoContinueOptions) => {
    if (state.isRunning) return;

    setState({
      isRunning: true,
      current: 0,
      total: options.targetSegments,
      lastSegment: null,
      warnings: [],
      error: null,
    });

    fetch(`/api/stories/${storyId}/auto-continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        branchId,
        ...options,
      }),
    }).then(async (response) => {
      if (!response.ok) {
        const error = await response.json();
        setState(prev => ({
          ...prev,
          isRunning: false,
          error: error.error || '请求失败',
        }));
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) return;

      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';

        for (const line of lines) {
          if (!line.trim() || !line.startsWith('data: ')) continue;
          const data = line.slice(6);
          if (data === '[DONE]') {
            setState(prev => ({ ...prev, isRunning: false }));
            onComplete?.();
            return;
          }

          try {
            const event = JSON.parse(data);

            switch (event.type) {
              case 'started':
                setState(prev => ({
                  ...prev,
                  total: event.targetSegments,
                }));
                break;

              case 'progress':
                setState(prev => ({
                  ...prev,
                  current: event.current,
                  lastSegment: event.segment,
                }));
                onProgress?.(event.current, event.total);
                onSegment?.(event.segment);
                break;

              case 'warning':
                setState(prev => ({
                  ...prev,
                  warnings: [...prev.warnings, event.message],
                }));
                break;

              case 'rate_limit':
                console.log(`限流等待 ${event.waitSeconds} 秒`);
                break;

              case 'error':
                setState(prev => ({
                  ...prev,
                  isRunning: false,
                  error: event.message,
                }));
                break;

              case 'complete':
                setState(prev => ({
                  ...prev,
                  isRunning: false,
                  current: event.totalSegments,
                }));
                onComplete?.();
                break;

              case 'aborted':
              case 'paused':
                setState(prev => ({ ...prev, isRunning: false }));
                break;
            }
          } catch (e) {
            console.error('解析事件失败:', e);
          }
        }
      }
    }).catch((error) => {
      setState(prev => ({
        ...prev,
        isRunning: false,
        error: error.message,
      }));
    });
  }, [storyId, branchId, state.isRunning, onComplete, onProgress, onSegment]);

  const stop = useCallback(() => {
    // SSE 不支持真正的 abort，但可以停止处理
    setState(prev => ({ ...prev, isRunning: false }));
  }, []);

  return {
    start,
    stop,
    state,
    isRunning: state.isRunning,
    progress: state.total > 0 ? (state.current / state.total) * 100 : 0,
  };
}

/**
 * 自动续写控制面板组件
 *
 * @example
 * <AutoContinuePanel storyId="story-123" />
 */
export function AutoContinuePanel({
  storyId,
  branchId = 'main',
  onComplete,
}: {
  storyId: string;
  branchId?: string;
  onComplete?: () => void;
}) {
  const [targetSegments, setTargetSegments] = useState(10);
  const [segmentDelay, setSegmentDelay] = useState(1000);
  const [pauseOnWarning, setPauseOnWarning] = useState(false);

  const { start, stop, state, progress } = useAutoContinue({
    storyId,
    branchId,
    onComplete,
  });

  const handleStart = () => {
    start({
      targetSegments,
      segmentDelay,
      pauseOnWarning,
    });
  };

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
      <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-4">
        自动续写
      </h3>

      {state.isRunning ? (
        <div className="space-y-4">
          {/* 进度条 */}
          <div>
            <div className="flex justify-between text-sm text-gray-600 dark:text-gray-400 mb-1">
              <span>进度</span>
              <span>{state.current} / {state.total}</span>
            </div>
            <div className="h-2 bg-gray-200 rounded-full dark:bg-gray-700">
              <div
                className="h-2 bg-blue-600 rounded-full transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>

          {/* 最新段落预览 */}
          {state.lastSegment && (
            <div className="text-sm">
              <p className="font-medium text-gray-700 dark:text-gray-300">
                {state.lastSegment.title}
              </p>
              <p className="text-gray-600 dark:text-gray-400 line-clamp-2">
                {state.lastSegment.content}
              </p>
            </div>
          )}

          {/* 警告 */}
          {state.warnings.length > 0 && (
            <div className="text-sm text-yellow-600 dark:text-yellow-400">
              <p className="font-medium">警告:</p>
              <ul className="list-disc list-inside">
                {state.warnings.slice(-3).map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          {/* 停止按钮 */}
          <button
            onClick={stop}
            className="w-full py-2 px-4 bg-red-600 hover:bg-red-700 text-white rounded-lg font-medium transition-colors"
          >
            停止续写
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {/* 配置项 */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              续写段数
            </label>
            <input
              type="number"
              min={1}
              max={500}
              value={targetSegments}
              onChange={(e) => setTargetSegments(parseInt(e.target.value) || 10)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              段间延迟 (毫秒)
            </label>
            <input
              type="number"
              min={0}
              max={10000}
              step={100}
              value={segmentDelay}
              onChange={(e) => setSegmentDelay(parseInt(e.target.value) || 1000)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg dark:border-gray-600 dark:bg-gray-700 dark:text-white"
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="pauseOnWarning"
              checked={pauseOnWarning}
              onChange={(e) => setPauseOnWarning(e.target.checked)}
              className="h-4 w-4 text-blue-600 rounded"
            />
            <label htmlFor="pauseOnWarning" className="ml-2 text-sm text-gray-700 dark:text-gray-300">
              一致性警告时暂停
            </label>
          </div>

          {/* 错误信息 */}
          {state.error && (
            <p className="text-sm text-red-600 dark:text-red-400">
              错误: {state.error}
            </p>
          )}

          {/* 开始按钮 */}
          <button
            onClick={handleStart}
            className="w-full py-2 px-4 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            开始续写 {targetSegments} 段
          </button>
        </div>
      )}
    </div>
  );
}

export default AutoContinuePanel;

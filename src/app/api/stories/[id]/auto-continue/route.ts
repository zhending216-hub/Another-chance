import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getUserIdFromRequest } from '@/lib/auth-helpers';
import { canViewStory } from '@/lib/permissions';
import { getOrderedChain } from '@/lib/chain-helpers';
import { buildFullPrompt, correctCharacterNames } from '@/lib/prompt-builder';
import { PacingEngine } from '@/lib/pacing-engine';
import { consistencyChecker } from '@/lib/consistency-checker';
import { callAIText, buildOpenAIRequest, aiRequestQueue } from '@/lib/ai-client';
import { contextSummarizer } from '@/lib/context-summarizer';
import { characterManager } from '@/lib/character-engine';
import { directorManager } from '@/lib/director-manager';
import { EventTracker } from '@/lib/event-tracker';
import { triggerBackup } from '@/lib/auto-backup';
import { extractFinalAnswer, getContinuationMaxTokens, isReasoningModelName } from '@/lib/continuation/generation';
import type { PacingConfig, DirectorState } from '@/types/story';

interface AutoContinueOptions {
  branchId?: string;
  targetSegments: number;
  pacingConfig?: PacingConfig;
  directorOverrides?: Partial<DirectorState>;
  /** 每段之间的延迟（毫秒），默认 1000 */
  segmentDelay?: number;
  /** 是否在一致性警告时暂停，默认 false */
  pauseOnWarning?: boolean;
  /** 最大重试次数，默认 3 */
  maxRetries?: number;
}

/**
 * 自动持续续写 API
 *
 * SSE 事件类型：
 * - progress: { type: 'progress', current: number, total: number, segment: StorySegment }
 * - warning: { type: 'warning', segmentIndex: number, message: string }
 * - error: { type: 'error', message: string, segmentIndex?: number }
 * - complete: { type: 'complete', totalSegments: number, storyId: string, branchId: string }
 * - rate_limit: { type: 'rate_limit', waitSeconds: number }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: { id: string } },
) {
  const storyId = params.id;

  try {
    const userId = await getUserIdFromRequest(request);
    if (!userId) {
      return NextResponse.json({ error: '请先登录' }, { status: 401 });
    }

    const body: AutoContinueOptions = await request.json();
    const {
      branchId = 'main',
      targetSegments,
      pacingConfig,
      directorOverrides,
      segmentDelay = 1000,
      pauseOnWarning = false,
      maxRetries = 3,
    } = body;

    if (!targetSegments || targetSegments < 1 || targetSegments > 500) {
      return NextResponse.json({ error: 'targetSegments 必须在 1-500 之间' }, { status: 400 });
    }

    const story = await prisma.story.findUnique({ where: { id: storyId } });
    if (!story) {
      return NextResponse.json({ error: '故事不存在' }, { status: 404 });
    }

    if (!canViewStory(story, userId)) {
      return NextResponse.json({ error: '无权查看' }, { status: 403 });
    }

    const modelName = (process.env.AI_MODEL || '').toLowerCase();
    const isReasoningModel = isReasoningModelName(modelName);

    const encoder = new TextEncoder();
    let aborted = false;

    const stream = new ReadableStream({
      async start(controller) {
        const sendEvent = (data: object) => {
          if (!aborted) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
          }
        };

        const completedSegments: string[] = [];

        try {
          sendEvent({
            type: 'started',
            storyId,
            branchId,
            targetSegments,
            estimatedTimeSeconds: Math.ceil(targetSegments * 3), // 粗略估计
          });

          for (let i = 0; i < targetSegments; i++) {
            if (aborted) {
              sendEvent({ type: 'aborted', completedSegments: i });
              break;
            }

            // 检查队列状态，如果排队太多则等待
            const queueStatus = aiRequestQueue.getStatus();
            if (queueStatus.queued > 5) {
              sendEvent({
                type: 'rate_limit',
                waitSeconds: 10,
                queueStatus,
              });
              await new Promise(resolve => setTimeout(resolve, 10000));
            }

            // 获取最新的故事链
            const chain = await getOrderedChain(storyId, branchId);
            if (chain.length === 0) {
              sendEvent({ type: 'error', message: '该分支没有段落', segmentIndex: i });
              break;
            }
            const tailSegment = chain[chain.length - 1];

            // 一致性检查（可选暂停）
            try {
              const issues = await consistencyChecker.checkChainConsistency(chain as any);
              if (issues.length > 0) {
                const warnings = issues.map((issue: any) => `[${issue.severity}] ${issue.description}`);
                sendEvent({ type: 'warning', segmentIndex: i, message: warnings.join('; ') });

                if (pauseOnWarning) {
                  sendEvent({ type: 'paused', reason: 'consistency_warning', segmentIndex: i });
                  break;
                }
              }
            } catch (e) {
              console.warn('[auto-continue] 一致性检查失败:', e);
            }

            // 构建 Prompt
            const fullResult = await buildFullPrompt({
              storyId,
              branchId,
              tailSegment: tailSegment as any,
              chain: chain as any,
              storyTitle: story.title,
              storyDescription: story.description ?? undefined,
              pacingConfig,
              directorOverrides,
            });
            const prompt = fullResult.prompt;
            const registeredCharacterNames = fullResult.registeredCharacterNames;

            // 计算 maxTokens
            const baseMaxTokens = pacingConfig
              ? new PacingEngine(pacingConfig).getMaxTokens()
              : 2000;
            const maxTokens = getContinuationMaxTokens(baseMaxTokens, modelName);

            // 调用 AI（带重试）
            let aiResponse: string | null = null;
            let retryCount = 0;

            while (!aiResponse && retryCount < maxRetries) {
              try {
                const response = await fetch(
                  buildOpenAIRequest(prompt, undefined, maxTokens, story as any).url,
                  {
                    method: 'POST',
                    headers: buildOpenAIRequest(prompt, undefined, maxTokens, story as any).headers,
                    body: buildOpenAIRequest(prompt, undefined, maxTokens, story as any).body,
                  }
                );

                if (!response.ok) {
                  if (response.status === 429) {
                    const retryAfter = response.headers.get('Retry-After');
                    const waitSeconds = retryAfter ? parseInt(retryAfter, 10) : 30;
                    sendEvent({ type: 'rate_limit', waitSeconds });
                    await new Promise(resolve => setTimeout(resolve, waitSeconds * 1000));
                    retryCount++;
                    continue;
                  }
                  throw new Error(`AI API error: ${response.status}`);
                }

                const data = await response.json();
                const msg = data.choices?.[0]?.message;
                aiResponse = msg?.content || msg?.reasoning_content || '';

                // 推理模型处理
                if (!aiResponse && msg?.reasoning_content) {
                  aiResponse = extractFinalAnswer(msg.reasoning_content);
                }
              } catch (e) {
                retryCount++;
                if (retryCount >= maxRetries) {
                  throw e;
                }
                sendEvent({
                  type: 'warning',
                  segmentIndex: i,
                  message: `请求失败，重试 ${retryCount}/${maxRetries}`,
                });
                await new Promise(resolve => setTimeout(resolve, 2000 * retryCount));
              }
            }

            if (!aiResponse || aiResponse.trim().length === 0) {
              sendEvent({ type: 'error', message: 'AI 未生成有效内容', segmentIndex: i });
              continue;
            }

            // 角色名纠错
            let finalContent = aiResponse;
            if (registeredCharacterNames.length > 0) {
              finalContent = correctCharacterNames(finalContent, registeredCharacterNames);
            }

            // 乐观锁检查
            const currentChain = await getOrderedChain(storyId, branchId);
            const currentTail = currentChain[currentChain.length - 1];
            if (currentTail?.id !== tailSegment.id) {
              sendEvent({
                type: 'warning',
                segmentIndex: i,
                message: '检测到并发修改，跳过本段',
              });
              continue;
            }

            // 保存段落
            const newSegment = await prisma.storySegment.create({
              data: {
                storyId,
                title: `故事续写 #${i + 1}`,
                content: finalContent,
                isBranchPoint: false,
                branchId,
                parentSegmentId: tailSegment.id,
                imageUrls: [],
                narrativePace: pacingConfig?.pace,
                mood: pacingConfig?.mood,
                visibility: story.visibility,
              },
            });

            completedSegments.push(newSegment.id);

            // 发送进度事件
            sendEvent({
              type: 'progress',
              current: i + 1,
              total: targetSegments,
              segment: {
                id: newSegment.id,
                title: newSegment.title,
                content: newSegment.content.slice(0, 200) + (newSegment.content.length > 200 ? '...' : ''),
              },
            });

            // 后处理（fire-and-forget）
            (async () => {
              try {
                let mentionedIds: string[] = [];
                try {
                  const mentioned = await characterManager.discoverAndRegisterCharacters(
                    storyId,
                    finalContent,
                    (p: string) => callAIText(p, { maxTokens: 1200, story: story as any }),
                    {
                      genre: story.genre ?? undefined,
                      storyDescription: story.description ?? undefined,
                      callAIWithWebSearchFn: (p: string) => callAIText(p, { maxTokens: 1500, story: story as any, webSearch: true }),
                    },
                  );
                  mentionedIds = mentioned.map(c => c.id);
                  if (mentionedIds.length > 0) {
                    await prisma.storySegment.update({
                      where: { id: newSegment.id },
                      data: { characterIds: mentionedIds },
                    });
                  }
                } catch (e) {
                  console.warn('[auto-continue] 角色发现失败:', e);
                }

                contextSummarizer.generateSegmentSummary(
                  newSegment as any,
                  [...chain, newSegment] as any,
                  story?.genre ?? undefined
                ).catch(() => {});

                if (mentionedIds.length > 0) {
                  characterManager.inferAndUpdateStatesForSegment(
                    storyId,
                    newSegment.id,
                    finalContent,
                    (p: string) => callAIText(p, { maxTokens: 1200, story: story as any })
                  ).catch(() => {});
                }

                directorManager.updateSceneState(
                  storyId,
                  finalContent,
                  (p: string) => callAIText(p, { maxTokens: 1200, story: story as any })
                ).catch(() => {});

                new EventTracker().processSegment(storyId, branchId, {
                  id: newSegment.id,
                  content: finalContent,
                  characterIds: mentionedIds,
                }).catch(() => {});
              } catch (e) {
                console.warn('[auto-continue] 后处理失败:', e);
              }
            })();

            // 段间延迟
            if (i < targetSegments - 1 && segmentDelay > 0) {
              await new Promise(resolve => setTimeout(resolve, segmentDelay));
            }
          }

          // 完成
          triggerBackup();
          sendEvent({
            type: 'complete',
            totalSegments: completedSegments.length,
            storyId,
            branchId,
          });

        } catch (error) {
          console.error('[auto-continue] 执行失败:', error);
          sendEvent({
            type: 'error',
            message: error instanceof Error ? error.message : String(error),
          });
        } finally {
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          controller.close();
        }
      },
      cancel() {
        aborted = true;
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });

  } catch (error) {
    console.error('[auto-continue] 初始化失败:', error);
    return NextResponse.json(
      { error: '自动续写失败', details: String(error) },
      { status: 500 },
    );
  }
}

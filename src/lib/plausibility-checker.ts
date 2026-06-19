/**
 * AI 合理性检测引擎
 *
 * 在续写完成后，使用 AI 对生成内容进行多维度合理性检测：
 * - 角色行为合理性
 * - 情节逻辑合理性
 * - 世界观一致性
 * - 历史事实准确性（针对历史题材）
 */

import { extractJsonFromAI } from './ai-client';

export type PlausibilitySeverity = 'critical' | 'major' | 'minor' | 'suggestion';

export interface PlausibilityIssue {
  dimension: 'character' | 'plot' | 'worldview' | 'historical' | 'style';
  severity: PlausibilitySeverity;
  title: string;
  description: string;
  evidence: string;
  suggestion: string;
  confidence: number; // 0-1，AI 对此问题的确信度
}

export interface PlausibilityReport {
  isPlausible: boolean;
  overallScore: number; // 0-100，整体合理性分数
  issues: PlausibilityIssue[];
  summary: string;
  checkedAt: string;
}

export interface PlausibilityCheckContext {
  storyTitle: string;
  storyDescription?: string;
  genre?: string;
  existingContent: string; // 前文内容
  newContent: string; // 新生成的内容
  characterNames?: string[];
  worldSettings?: Record<string, any>;
  fandomName?: string;
}

/**
 * 使用 AI 对新内容进行合理性检测
 */
export async function checkPlausibilityWithAI(
  context: PlausibilityCheckContext,
  callAIFn: (prompt: string) => Promise<string>,
): Promise<PlausibilityReport> {
  const {
    storyTitle,
    storyDescription,
    genre,
    existingContent,
    newContent,
    characterNames,
    worldSettings,
    fandomName,
  } = context;

  const characterList = characterNames?.length
    ? `\n已知角色：${characterNames.join('、')}`
    : '';

  const worldSettingsHint = worldSettings && Object.keys(worldSettings).length > 0
    ? `\n世界观设定：${JSON.stringify(worldSettings).slice(0, 500)}`
    : '';

  const fandomHint = fandomName
    ? `\n作品/IP：${fandomName}（同人创作需严格遵循原作设定）`
    : '';

  const historicalHint = genre?.includes('史') || genre?.includes('历史')
    ? `\n【重要】这是历史题材，请特别关注历史事实的准确性，包括：人物、时间、地点、事件、制度、称谓等。`
    : '';

  const prompt = `你是一位专业的文学编辑和故事审核专家。请对以下故事续写内容进行合理性检测。

故事标题：${storyTitle}
故事简介：${storyDescription || '无'}${characterList}${worldSettingsHint}${fandomHint}${historicalHint}

【前文内容（最后500字）】
${existingContent.slice(-500)}

【新生成的内容】
${newContent}

请从以下维度检测合理性：

1. **角色行为合理性** (character)
   - 角色行为是否符合其已建立的性格特征
   - 角色能力是否超出合理范围
   - 角色之间的关系互动是否合理
   - 已死亡/离场角色是否不当出现

2. **情节逻辑合理性** (plot)
   - 情节发展是否与前文连贯
   - 是否存在逻辑跳跃或矛盾
   - 事件因果关系是否合理
   - 是否有未解释的突兀转折

3. **世界观一致性** (worldview)
   - 是否违反已建立的世界观设定
   - 超自然/特殊元素是否自洽
   - 社会制度、文化背景是否一致

4. **历史事实准确性** (historical)
   - 历史人物、时间、地点是否准确
   - 历史事件、制度、称谓是否正确
   - 是否有明显的时代错误（如时代错乱）

5. **风格一致性** (style)
   - 文风是否与前文一致
   - 用词、句式是否协调
   - 叙事节奏是否恰当

严格输出 JSON 格式，不要 markdown，不要解释：
{
  "isPlausible": true/false,
  "overallScore": 0-100,
  "issues": [
    {
      "dimension": "character|plot|worldview|historical|style",
      "severity": "critical|major|minor|suggestion",
      "title": "问题标题（简短）",
      "description": "问题详细描述",
      "evidence": "原文中的具体证据",
      "suggestion": "修改建议",
      "confidence": 0.0-1.0
    }
  ],
  "summary": "整体评价（一句话）"
}

注意：
- severity: critical（严重错误，必须修改）, major（较大问题，建议修改）, minor（小问题）, suggestion（优化建议）
- 只报告真正的问题，不要过度挑剔
- confidence 表示你对此问题判断的确信程度`;

  try {
    const raw = await callAIFn(prompt);
    const parsed = extractJsonFromAI<PlausibilityReport>(raw);

    if (!parsed || typeof parsed !== 'object') {
      return createFallbackReport('AI 返回格式错误');
    }

    // 验证和修正
    return {
      isPlausible: parsed.isPlausible ?? true,
      overallScore: Math.min(100, Math.max(0, parsed.overallScore ?? 70)),
      issues: (parsed.issues || [])
        .filter((issue: any) => issue && issue.dimension && issue.description)
        .map((issue: any) => ({
          dimension: issue.dimension,
          severity: issue.severity || 'minor',
          title: issue.title || '未命名问题',
          description: issue.description,
          evidence: issue.evidence || '',
          suggestion: issue.suggestion || '',
          confidence: Math.min(1, Math.max(0, issue.confidence ?? 0.7)),
        })),
      summary: parsed.summary || '检测完成',
      checkedAt: new Date().toISOString(),
    };
  } catch (e) {
    console.warn('[plausibility-checker] AI 检测失败:', e);
    return createFallbackReport(`AI 检测异常: ${e}`);
  }
}

/**
 * 快速检测（只返回是否合理和分数）
 */
export async function quickPlausibilityCheck(
  newContent: string,
  existingContent: string,
  callAIFn: (prompt: string) => Promise<string>,
): Promise<{ isPlausible: boolean; score: number; briefIssues: string[] }> {
  const prompt = `请快速判断以下故事续写是否合理。

前文结尾：${existingContent.slice(-300)}

新内容：${newContent}

只输出一行 JSON：{"isPlausible":true/false,"score":0-100,"briefIssues":["问题1","问题2"]}

标准：
- isPlausible: 是否基本合理（无严重矛盾）
- score: 合理性分数（0-100）
- briefIssues: 主要问题列表（最多3个，每个不超过15字）`;

  try {
    const raw = await callAIFn(prompt);
    const parsed = extractJsonFromAI<{ isPlausible: boolean; score: number; briefIssues: string[] }>(raw);
    return {
      isPlausible: parsed?.isPlausible ?? true,
      score: parsed?.score ?? 70,
      briefIssues: parsed?.briefIssues || [],
    };
  } catch {
    return { isPlausible: true, score: 70, briefIssues: [] };
  }
}

/**
 * 针对特定问题的修复建议
 */
export async function getFixSuggestion(
  issue: PlausibilityIssue,
  newContent: string,
  callAIFn: (prompt: string) => Promise<string>,
): Promise<string> {
  const prompt = `以下故事内容存在合理性问题，请提供修复后的版本。

问题类型：${issue.dimension}
问题描述：${issue.description}
证据：${issue.evidence}
建议：${issue.suggestion}

原文：
${newContent}

请输出修复后的完整内容（保持原有风格和长度，只修正问题部分）：`;

  try {
    const fixed = await callAIFn(prompt);
    return fixed.trim();
  } catch (e) {
    console.warn('[plausibility-checker] 获取修复建议失败:', e);
    return newContent;
  }
}

/**
 * 创建兜底报告
 */
function createFallbackReport(reason: string): PlausibilityReport {
  return {
    isPlausible: true,
    overallScore: 70,
    issues: [],
    summary: `检测降级：${reason}`,
    checkedAt: new Date().toISOString(),
  };
}

// 导出单例函数
export const plausibilityChecker = {
  check: checkPlausibilityWithAI,
  quickCheck: quickPlausibilityCheck,
  getFixSuggestion,
};

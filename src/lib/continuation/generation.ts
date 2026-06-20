export function extractFinalAnswer(reasoning: string): string {
  const trimmed = reasoning.trim();

  const revisionPatterns = [
    /\*{1,2}修订文本[：:]\*{1,2}\s*\n?/,
    /\*{1,2}最终文本[：:]\*{1,2}\s*\n?/,
    /\*{1,2}润色后[：:]\*{1,2}\s*\n?/,
    /\*{1,2}正文[：:]\*{1,2}\s*\n?/,
  ];
  for (const pattern of revisionPatterns) {
    const match = trimmed.match(pattern);
    if (match) {
      const afterMarker = trimmed.slice(match.index! + match[0].length);
      const nextMarker = afterMarker.search(/\n\s*\d+\.\s+\*{1,2}|$/);
      if (nextMarker > 50) {
        return afterMarker.slice(0, nextMarker).trim();
      }
      return afterMarker.trim();
    }
  }

  const thinkingPatterns = [
    /^\d+\.\s+\*{1,2}[^*]+\*{1,2}[：:]/gm,
    /\*{1,2}对照约束检查\*{1,2}/g,
    /\*{1,2}最终润色\*{1,2}/g,
    /\*{1,2}检查[：:]\*{1,2}/g,
    /\*{1,2}分析[：:]\*{1,2}/g,
    /\*{1,2}思考[：:]\*{1,2}/g,
  ];

  let cleaned = trimmed;
  for (const pattern of thinkingPatterns) {
    cleaned = cleaned.replace(pattern, '');
  }

  const paragraphs = cleaned.split(/\n\n+/).filter(p => {
    const line = p.trim();
    if (line.match(/^\d+\./)) return false;
    if (line.match(/^\*{1,2}/)) return false;
    if (line.match(/^[（\(]\d+[）\)]/)) return false;
    if (line.length < 30) return false;
    return true;
  });

  if (paragraphs.length > 0) {
    return paragraphs.join('\n\n').trim();
  }

  const markers = ['因此，', '综上所述，', '乃', '于是'];
  for (const marker of markers) {
    const idx = trimmed.lastIndexOf(marker);
    if (idx !== -1 && idx < trimmed.length - 100) {
      const afterMarker = trimmed.slice(idx);
      const nextThinking = afterMarker.search(/\n\s*\d+\.\s+\*{1,2}|$/);
      return afterMarker.slice(0, nextThinking).trim();
    }
  }

  const allLines = trimmed.split(/\n+/);
  const narrativeLines: string[] = [];
  for (let i = allLines.length - 1; i >= 0; i--) {
    const line = allLines[i].trim();
    if (line.match(/^\d+\.\s+\*{1,2}/) || line.match(/^[（\(]\d+[）\)]/)) {
      break;
    }
    if (line.length > 20 && !line.match(/^\*{1,2}/)) {
      narrativeLines.unshift(line);
    }
    if (narrativeLines.length >= 5) break;
  }

  if (narrativeLines.length > 0) {
    return narrativeLines.join('\n').trim();
  }

  return trimmed;
}

export function isReasoningModelName(modelName = process.env.AI_MODEL || ''): boolean {
  const normalized = modelName.toLowerCase();
  return normalized.includes('5.') ||
    normalized.includes('deepseek-r') ||
    normalized.includes('reasoning') ||
    normalized.includes('glm-4.7');
}

export function getContinuationMaxTokens(baseMaxTokens: number, modelName = process.env.AI_MODEL || ''): number {
  return isReasoningModelName(modelName) ? Math.max(baseMaxTokens + 4000, 6000) : baseMaxTokens;
}

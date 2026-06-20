import { consistencyChecker } from '@/lib/consistency-checker';

export async function collectConsistencyWarnings(chain: unknown[], logPrefix: string): Promise<string[]> {
  try {
    const issues = await consistencyChecker.checkChainConsistency(chain as any);
    return issues.map((issue: any) => `[${issue.severity}] ${issue.description}`);
  } catch (e) {
    console.warn(`${logPrefix} 矛盾检测失败:`, e);
    return [];
  }
}

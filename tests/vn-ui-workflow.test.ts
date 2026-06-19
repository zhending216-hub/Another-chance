import { describe, expect, it } from 'vitest';
import {
  AIVN_ASSET_CATEGORIES,
  VN_ASSET_WORKFLOW_OPTIONS,
  buildAIVNGenerateEndpoint,
  buildAIVNGenerateRequest,
  buildVNChapterAssetsEndpoint,
  buildVNChapterExportEndpoint,
  summarizeAIVNValidation,
} from '@/lib/vn/ui-workflow';

describe('AIVN UI workflow contract', () => {
  it('builds encoded fused generation and chapter asset endpoints', () => {
    expect(buildAIVNGenerateEndpoint('story/one')).toBe('/api/stories/story%2Fone/aivn-generate');
    expect(buildVNChapterAssetsEndpoint('story one', 'chapter/1')).toBe(
      '/api/stories/story%20one/vn-chapters/chapter%2F1/assets',
    );
    expect(buildVNChapterExportEndpoint('story one', 'chapter/1', 'aivn-zip')).toBe(
      '/api/stories/story%20one/vn-chapters/chapter%2F1/export?format=aivn-zip',
    );
  });

  it('uses strict fused generation defaults for UI requests', () => {
    expect(buildAIVNGenerateRequest({
      branchId: '',
      persist: true,
      maxRepairAttempts: 99,
    })).toEqual({
      branchId: 'main',
      sourceSegmentId: undefined,
      persist: true,
      includeDebug: false,
      includeGeneratedAssets: true,
      requireEndingTerminal: true,
      maxRepairAttempts: 2,
      chapterId: undefined,
    });
  });

  it('exposes all fused image asset categories with graph behavior labels', () => {
    expect(AIVN_ASSET_CATEGORIES).toEqual(['Background', 'Tachi', 'Illustration']);
    expect(VN_ASSET_WORKFLOW_OPTIONS.map(option => option.category)).toEqual(AIVN_ASSET_CATEGORIES);
    expect(VN_ASSET_WORKFLOW_OPTIONS.find(option => option.category === 'Background')?.graphBehavior).toContain('graph');
    expect(VN_ASSET_WORKFLOW_OPTIONS.find(option => option.category === 'Tachi')?.graphBehavior).toContain('入包');
  });

  it('summarizes validation results for the UI', () => {
    expect(summarizeAIVNValidation(null)).toMatchObject({ tone: 'idle' });
    expect(summarizeAIVNValidation({ valid: true })).toMatchObject({ tone: 'ok', label: '验证通过' });
    expect(summarizeAIVNValidation({ valid: true, issues: ['minor'] })).toMatchObject({ tone: 'warn' });
    expect(summarizeAIVNValidation({ valid: false, error: 'missing End' })).toMatchObject({
      tone: 'error',
      detail: 'missing End',
    });
  });
});

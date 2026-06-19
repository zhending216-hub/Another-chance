import { describe, expect, it } from 'vitest';
import { buildVNChapterCreateData } from '@/lib/vn/storage';
import type { VNGraphPreviewResult } from '@/lib/vn/generation-service';

describe('VN chapter storage helpers', () => {
  it('builds valid chapter create data', () => {
    const data = buildVNChapterCreateData({
      storyId: 'story-1',
      branchId: 'main',
      sourceSegmentId: 'seg-1',
      createdById: 'user-1',
      result: previewResult(true),
    });

    expect(data.status).toBe('valid');
    expect(data.validationError).toBeNull();
    expect(data.graphJson).toEqual({ Version: 1, StartNodeIndex: 1, Nodes: [] });
    expect(data.createdById).toBe('user-1');
  });

  it('builds invalid chapter create data with raw validation error', () => {
    const data = buildVNChapterCreateData({
      storyId: 'story-1',
      branchId: 'main',
      result: previewResult(false),
    });

    expect(data.status).toBe('invalid');
    expect(data.graphJson).toBeUndefined();
    expect(data.validationError).toBe('bad graph');
    expect(data.createdById).toBeNull();
  });
});

function previewResult(success: boolean): VNGraphPreviewResult {
  return {
    success,
    graph: success ? { Version: 1, StartNodeIndex: 1, Nodes: [] } : null,
    rawAIText: success ? '{"Version":1}' : 'not valid',
    validation: success
      ? { valid: true, error: '', errors: [] }
      : { valid: false, error: 'bad graph', errors: ['bad graph'] },
    repairAttempts: success ? 0 : 1,
  };
}

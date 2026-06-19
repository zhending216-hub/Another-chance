'use client';

import { useState } from 'react';

interface PlausibilityIssue {
  dimension: 'character' | 'plot' | 'worldview' | 'historical' | 'style';
  severity: 'critical' | 'major' | 'minor' | 'suggestion';
  title: string;
  description: string;
  evidence: string;
  suggestion: string;
  confidence: number;
}

interface PlausibilityReport {
  isPlausible: boolean;
  overallScore: number;
  issues: PlausibilityIssue[];
  summary: string;
  checkedAt: string;
}

interface PlausibilityPanelProps {
  storyId: string;
  segmentId?: string;
  branchId?: string;
  onCheckComplete?: (report: PlausibilityReport) => void;
}

const severityColors = {
  critical: 'bg-red-100 text-red-800 border-red-300',
  major: 'bg-orange-100 text-orange-800 border-orange-300',
  minor: 'bg-yellow-100 text-yellow-800 border-yellow-300',
  suggestion: 'bg-blue-100 text-blue-800 border-blue-300',
};

const severityLabels = {
  critical: '严重',
  major: '较大',
  minor: '较小',
  suggestion: '建议',
};

const dimensionLabels = {
  character: '角色',
  plot: '情节',
  worldview: '世界观',
  historical: '历史',
  style: '风格',
};

export function PlausibilityPanel({
  storyId,
  segmentId,
  branchId = 'main',
  onCheckComplete,
}: PlausibilityPanelProps) {
  const [report, setReport] = useState<PlausibilityReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const runCheck = async () => {
    setLoading(true);
    setError(null);

    try {
      const res = await fetch(`/api/stories/${storyId}/plausibility`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segmentId, branchId }),
      });

      const data = await res.json();

      if (!res.ok) {
        throw new Error(data.error || '检测失败');
      }

      setReport(data.report);
      onCheckComplete?.(data.report);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 80) return 'text-green-600';
    if (score >= 60) return 'text-yellow-600';
    return 'text-red-600';
  };

  return (
    <div className="border rounded-lg p-4 bg-white shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-lg font-semibold">合理性检测</h3>
        <button
          onClick={runCheck}
          disabled={loading}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? '检测中...' : '开始检测'}
        </button>
      </div>

      {error && (
        <div className="p-3 bg-red-50 text-red-700 rounded mb-4">
          {error}
        </div>
      )}

      {report && (
        <div className="space-y-4">
          {/* 总体评分 */}
          <div className="flex items-center gap-4 p-4 bg-gray-50 rounded">
            <div className={`text-4xl font-bold ${getScoreColor(report.overallScore)}`}>
              {report.overallScore}
            </div>
            <div>
              <div className="font-medium">
                {report.isPlausible ? '内容基本合理' : '内容存在问题'}
              </div>
              <div className="text-sm text-gray-600">{report.summary}</div>
            </div>
          </div>

          {/* 问题列表 */}
          {report.issues.length > 0 && (
            <div className="space-y-3">
              <h4 className="font-medium text-gray-700">
                发现 {report.issues.length} 个问题
              </h4>
              {report.issues.map((issue, idx) => (
                <div
                  key={idx}
                  className={`p-3 border rounded ${severityColors[issue.severity]}`}
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 text-xs rounded bg-white/50">
                      {severityLabels[issue.severity]}
                    </span>
                    <span className="px-2 py-0.5 text-xs rounded bg-white/50">
                      {dimensionLabels[issue.dimension]}
                    </span>
                    <span className="font-medium">{issue.title}</span>
                  </div>
                  <p className="text-sm mb-2">{issue.description}</p>
                  {issue.evidence && (
                    <p className="text-sm italic opacity-80">
                      证据：{issue.evidence}
                    </p>
                  )}
                  {issue.suggestion && (
                    <p className="text-sm mt-2 text-gray-700">
                      建议：{issue.suggestion}
                    </p>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* 检测时间 */}
          <div className="text-xs text-gray-500">
            检测时间：{new Date(report.checkedAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

export default PlausibilityPanel;

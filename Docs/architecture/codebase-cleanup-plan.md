# 服务器代码库整理分析与执行计划

> Date: 2026-06-20
> Server path: `/home/workspace/fengbohan/Another-chance`
> Branch: `fix/name-correction-and-misc-fixes`
> Purpose: 先分析怎么整理，不直接拆业务代码或执行数据库操作。

## 结论

当前代码库不是失控状态，但确实已经进入“历史堆叠偏重”的阶段。

核心判断：

```text
AIVN/Gushi 融合主链路是稳定的；
仓库整体需要结构整理；
整理应按批次推进，不能一次性大重构。
```

已经完成的低风险整理：

- 文档根目录统一到 `Docs/`。
- AIVN 发布文档归档到 `Docs/aivn/`。
- 新增 `Docs/README.md`、`scripts/README.md`、`tests/README.md`。
- `package.json` 新增固定 gate：`typecheck`、`test:vn`、`test:aivn-package`。

## 当前量化信号

只读扫描结果：

```text
TS/TSX/JS files: 168
as any: 132
console.log: 296
process.exit: 21
```

最大文件：

```text
1324 src/app/story/[id]/page.tsx
 874 src/lib/vn/phase9-skipped-migration.ts
 771 src/lib/image-generator.ts
 680 src/lib/vn/validator.ts
 667 src/lib/prompt-builder.ts
 623 src/lib/vn/bulk-migration.ts
 617 src/lib/character-engine.ts
 540 src/app/create/page.tsx
 536 scripts/stress-test-story.ts
 512 src/lib/context-summarizer.ts
 506 src/lib/consistency-checker.ts
 498 src/lib/ai-client.ts
 462 src/app/api/stories/[id]/stream-continue/route.ts
 458 src/lib/vn/visual-orchestration.ts
 453 src/app/api/stories/[id]/auto-continue/route.ts
```

需要规范的历史测试文件：

```text
scripts/manual-smoke/branch-memory-smoke.ts
scripts/manual-smoke/consistency-checker-smoke.ts
scripts/manual-smoke/context-summarizer-smoke.ts
scripts/manual-smoke/context-memory-e2e-smoke.ts
scripts/manual-smoke/event-tracker-smoke.ts
```

这些文件更像手动 smoke script，不适合作为默认 `vitest run` 的长期结构。

## 不要先做的事

以下事情不应该作为第一批整理：

- 不要改数据库 schema。
- 不要跑 Prisma migration。
- 不要批量写库。
- 不要重写 `Story`、`StorySegment`、`StoryBranch` 原始数据。
- 不要把 prose continuation 路由替换成 AIVN 路由。
- 不要把真实图片生成和 visual backfill 混进结构整理。
- 不要一次性拆多个 500+ 行核心文件。

## 整理原则

1. 每批只改一个层次：文档、测试、UI、API、service、脚本不要混在一个 commit。
2. 每批都必须能用固定 gate 验证：

```text
npm run typecheck
npm run test:vn
npm run test:aivn-package
```

3. 服务器改动前固定执行：

```text
git status --short --branch
```

4. 涉及数据库写入前，必须有：

```text
npm run db:backup
gzip -t backups/<backup>.sql.gz
```

5. `exports/` 和 `backups/` 继续作为 ignored runtime artifacts，不纳入 commit。

## 推荐分批计划

### Batch 1: 测试边界正常化

目标：让 `tests/` 只放真正 Vitest suite，手动 smoke 文件不再污染默认测试语义。

任务：

- 将历史手动 smoke 文件移动到 `scripts/manual-smoke/` 或 `scripts/manual/`。
- 或者把它们改造成真正的 `describe/test/expect` Vitest suite。
- 为迁移后的手动脚本补 README 说明：是否读库、是否写库、是否调用 AI provider。
- 在 `vitest.config.ts` 中明确 include/exclude，只让自动化测试被默认发现。

优先处理文件：

```text
scripts/manual-smoke/branch-memory-smoke.ts
scripts/manual-smoke/consistency-checker-smoke.ts
scripts/manual-smoke/context-summarizer-smoke.ts
scripts/manual-smoke/context-memory-e2e-smoke.ts
scripts/manual-smoke/event-tracker-smoke.ts
```

验证：

```text
npm run typecheck
npm run test:vn
npx vitest run
```

预期：`npx vitest run` 不再因为手动脚本语义而失败。

### Batch 2: Story 页面拆分

目标：降低 `src/app/story/[id]/page.tsx` 的维护风险。

当前问题：

- 1324 行单文件。
- 同时承担数据加载、分支管理、续写、流式展示、图片、VN 面板、合理性检测、编辑弹窗等职责。
- 新功能继续叠加会让页面变成回归高风险区。

建议拆分：

```text
src/app/story/[id]/page.tsx
src/app/story/[id]/StoryDetailClient.tsx
src/app/story/[id]/hooks/useStoryData.ts
src/app/story/[id]/hooks/useStoryContinuation.ts
src/app/story/[id]/hooks/useBranching.ts
src/app/story/[id]/components/StoryHeader.tsx
src/app/story/[id]/components/SegmentList.tsx
src/app/story/[id]/components/BottomActionBar.tsx
src/app/story/[id]/components/EditStoryModal.tsx
```

约束：

- 不改变 API 请求路径。
- 不改变 prose continuation 行为。
- 不改变 VN 面板入口。
- 每拆一个组件就跑一次 typecheck。

验证：

```text
npm run typecheck
npm run test:vn
```

再做一次浏览器 smoke：打开故事页、续写按钮、VN 章节按钮、分支按钮。

### Batch 3: continuation 路由抽服务层

目标：让 `continue`、`stream-continue`、`auto-continue` 共享上下文和校验逻辑，减少重复 `as any`。

当前高风险文件：

```text
src/app/api/stories/[id]/continue/route.ts
src/app/api/stories/[id]/stream-continue/route.ts
src/app/api/stories/[id]/auto-continue/route.ts
```

建议新增服务层：

```text
src/lib/continuation/context.ts
src/lib/continuation/generation.ts
src/lib/continuation/consistency.ts
src/lib/continuation/types.ts
```

先抽纯函数，不改变 route handler 的外部响应结构。

验证：

```text
npm run typecheck
npm run test:vn
```

如果补测试，优先给 service 层加单元测试，不先写端到端大测试。

### Batch 4: VN 模块瘦身

目标：保持 AIVN/Gushi 主链路稳定，同时降低 `src/lib/vn/` 的大文件阅读成本。

建议顺序：

1. `visual-orchestration.ts` 拆 node builder：

```text
src/lib/vn/visual-action-nodes.ts
src/lib/vn/visual-orchestration.ts
```

2. `validator.ts` 拆资产解析和 graph traversal helper：

```text
src/lib/vn/validator.ts
src/lib/vn/validator-assets.ts
src/lib/vn/validator-traversal.ts
```

3. `phase9-skipped-migration.ts` 标记为 historical migration，并尽量移动调用入口到 `scripts/`。不要改历史迁移逻辑。

4. `bulk-migration.ts` 保留 service API，但把 reporting/dry-run helper 分出去。

验证：

```text
npm run typecheck
npm run test:vn
npm run test:aivn-package
```

关键不变量：

- VNGraph validator 结果不能变化。
- `Outputs.Next` 不能被 visual orchestration 改写。
- 图片失败仍不能阻塞 text-only graph。

### Batch 5: 图片生成与日志治理

目标：降低 `src/lib/image-generator.ts`、`src/lib/prompt-builder.ts` 的调试日志和 provider 逻辑混杂。

任务：

- 引入轻量 logger，替换生产代码中的裸 `console.log`。
- 把 provider-specific 逻辑和 prompt assembly 分开。
- 保留手动诊断脚本中的 console 输出。
- 不在本批引入真实图片批量生成。

建议结构：

```text
src/lib/images/provider.ts
src/lib/images/prompt.ts
src/lib/images/validation.ts
src/lib/logger.ts
```

验证：

```text
npm run typecheck
npm run test:vn
```

图片 provider 相关测试使用 mock，不调用真实 provider。

### Batch 6: 类型边界治理

目标：逐步减少 `as any`，先从 API route 和 service boundary 入手。

优先文件：

```text
src/app/api/stories/[id]/stream-continue/route.ts
src/app/api/stories/[id]/continue/route.ts
src/app/api/stories/[id]/auto-continue/route.ts
src/lib/prompt-builder.ts
src/lib/character-engine.ts
```

方法：

- 新增 DTO 类型，不直接把 Prisma record 传给所有服务。
- 对 AI prompt 所需字段建立 `StoryForAI` / `SegmentForAI` 类型。
- 用 mapper 函数集中处理 nullable/legacy 字段。

验证：

```text
npm run typecheck
```

本批不要改业务算法，只改类型适配层。

## 建议 commit 顺序

```text
chore(tests): separate manual smoke scripts from vitest suites
refactor(story): split story detail page shell
refactor(story): extract story continuation hooks
refactor(api): share continuation context service
refactor(vn): split visual action node builders
refactor(vn): split validator helpers
chore(logging): gate noisy generation debug logs
refactor(types): add typed AI story adapters
```

每个 commit 都应该是可独立回滚的。

## 审核者检查清单

审核时重点看：

- 是否只动了本批承诺的层次。
- 是否新增了数据库写入或 migration。
- 是否改变了 `continue` / `stream-continue` 响应格式。
- 是否改变了 AIVN package manifest 或 object path 约定。
- 是否移动了 ignored artifacts 到 git tracking。
- 是否保留了 release gates。

## 当前推荐下一步

先做 Batch 1：测试边界正常化。

理由：

- 风险低。
- 能让 `npx vitest run` 语义恢复干净。
- 后续拆 UI/service 前，测试边界越清晰越安全。

完成 Batch 1 后，再进入 Story 页面拆分。不要同时开始大页面拆分和 continuation 路由抽象。
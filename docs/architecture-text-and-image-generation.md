# 古事项目：生文 & 生图逻辑调研完整报告

> 调研日期：2026-06-13
> 项目：Another-chance（古事 - 历史故事分叉续写平台）

---

## 一、生文（AI 文本续写）逻辑

### 1.1 入口 API 路由

| 路径 | 方法 | 核心职责 | 关键依赖 |
|------|------|---------|---------|
| `/api/stories/[id]/continue/route.ts` | POST | 单次续写（非流式），返回完整段落 | `prompt-builder`, `ai-client`, `character-engine`, `director-manager`, `consistency-checker`, `plausibility-checker`, `timeline-engine` |
| `/api/stories/[id]/stream-continue/route.ts` | POST | 单次续写（流式 SSE），边生成边推送 | 同上 + ReadableStream |
| `/api/stories/[id]/auto-continue/route.ts` | POST | 批量自动续写（SSE），支持 1-500 段 | 同上 + `aiRequestQueue` 队列控制 |
| `/api/stories/[id]/debug-prompt/route.ts` | GET | 调试端点，返回完整 prompt 结构 | `prompt-builder` |
| `/api/stories/[id]/plausibility/route.ts` | POST | 独立合理性检测端点 | `plausibility-checker` |

### 1.2 核心库详解

#### `src/lib/ai-client.ts`（498 行）

**暴露函数**：
- `callAI(prompt, options)` → 返回完整 Response（走优先级队列 + 重试）
- `callAIText(prompt, options)` → 返回文本内容（自动提取 `content` 或 `reasoning_content`）
- `buildOpenAIRequest(prompt, systemPrompt, maxTokens, story, enableWebSearch)` → 构建请求体
- `callAIWithRetry(requestFn, retryConfig)` → 底层重试封装（指数退避，支持 429/5xx）
- `extractJsonFromAI<T>(text)` → 从 AI 输出中健壮提取 JSON（处理 markdown 代码块、推理模型混入思考文本）

**队列与限流**：
- `AIRequestQueue` 类：并发控制（默认 3 并发）、全局限流（20 次/分钟）、优先级队列（high/medium/low）
- 自动处理 GLM 模型的 `web_search` 工具（仅 BigModel 端点支持）

**默认参数**：
- 模型：`process.env.AI_MODEL || 'gpt-3.5-turbo'`
- temperature：历史类 0.4 / 同人类 0.6 / 其他 0.5
- top_p: 0.85, frequency_penalty: 0.3, max_tokens: 2000

**流式支持**：`callAI` 本身支持 `stream: true` 选项，但当前项目通过 `stream-continue/route.ts` 直接使用 fetch 流式读取。

---

#### `src/lib/prompt-builder.ts`（667 行）

**核心函数**：`buildFullPrompt(options)` → 返回 `{ prompt, knownCharacterNames, registeredCharacterNames }`

**Prompt 组装顺序**（逐层堆叠）：
1. **系统指令**（风格指令，按 genre 分支：科幻/悬疑/都市/玄幻/仙侠/武侠/穿越/同人/奇幻/架空/演义/军事/原创/历史）
2. **故事元信息**（标题 + 描述）
3. **风格锚点**（第一段开头 200 字作为文体参照）
4. **角色状态**（`characterManager.buildCharacterPrompt`）
5. **活跃事件**（`EventTracker` 提取未闭合悬念）
6. **分支记忆**（`branchMemory.buildBranchMemoryPrompt`）
7. **导演覆盖**（`directorManager.buildDirectorPrompt`）
8. **前文上下文**（`contextSummarizer.getContextForPrompt`，动态 token 预算）
9. **世界观**（`timelineEngine` + `lorebook` + `fandomLorebook`）
10. **节奏指令**（`PacingEngine.buildPacingInstruction`）
11. **记忆提醒**（硬约束 + 角色名精确约束 + 未闭合悬念）
12. **续写指令**（字数提示 + 风格提示 + 连续性提示）

**关键特性**：
- **动态 Token 预算**：根据实际可用数据分配（角色 15%、事件 15%、分支记忆 10%、世界观 20%、上下文 40%）
- **角色名自动纠错**：`correctCharacterNames(text, knownNames)` 检测形近字错误并替换
- **Genre 自动推断**：从 `description` 中匹配关键词推断 genre（如果用户未填）
- **风格覆盖检测**：当检测到"应使用现代文体却用了古风"时，强制注入覆盖指令

---

#### `src/lib/character-engine.ts`（617 行）

**职责**：角色管理系统的核心，负责角色发现、注册、状态推断。

**主要方法**：
- `discoverAndRegisterCharacters(storyId, text, callAIFn, options)` → 从文本中提取并注册角色
- `buildCharacterPrompt(characterIds)` → 构建角色状态 prompt
- `inferAndUpdateStatesForSegment(storyId, segmentId, text, callAIFn)` → 推断角色状态变化
- `list(storyId)` → 列出故事所有角色

**与生文的关系**：续写完成后，调用 `discoverAndRegisterCharacters` 自动发现新角色，并异步调用 `inferAndUpdateStatesForSegment` 更新角色状态。

---

#### 其他支撑库

| 库 | 行数 | 在生文链路中的作用 |
|---|---|---|
| `pacing-engine.ts` | 109 | 叙事节奏控制（rush/detailed/pause/summary），影响字数和细节程度 |
| `director-manager.ts` | 227 | 导演模式（角色状态、世界变量、叙事约束），通过 `directorOverrides` 覆盖 |
| `context-summarizer.ts` | 512 | 长文本压缩，生成分段摘要和上下文摘要 |
| `branch-memory.ts` | 233 | 分支记忆，确保分叉分支独立叙事 |
| `consistency-checker.ts` | 506 | 一致性检查，检测情节矛盾（写作前后调用两次） |
| `timeline-engine.ts` | 145 | 时间轴校验，检测时间倒流 |
| `lorebook.ts` | 106 | 世界观设定集（历史 era 对应的事实锚点） |
| `web-search.ts` | 108 | 网络搜索（已存在但未在生文主链路使用） |
| `character-extractor.ts` | 246 | **新增**：严格人名提取（过滤地名+形容词、拟声词等误提取） |
| `plausibility-checker.ts` | 254 | **新增**：AI 合理性检测（角色行为/情节逻辑/世界观/历史事实/风格） |

---

### 1.3 前端触发入口

**页面**：`src/app/story/[id]/page.tsx`
- 流式续写：`handleStreamContinue` 函数（第 201 行）调用 `POST /api/stories/${id}/stream-continue`
- 自动续写面板：`src/components/AutoContinuePanel.tsx`（第 75 行）调用 `POST /api/stories/${storyId}/auto-continue`

**触发方式**：
1. 用户点击"续写"按钮 → 触发流式续写
2. 用户在自动续写面板设置参数（目标段数、节奏、延迟等）→ 触发批量续写

---

### 1.4 数据流（端到端调用链）

```
用户点击"续写"
  ↓
前端 POST /api/stories/{id}/stream-continue (或 continue)
  ↓
route.ts:24-46    权限校验 + 获取 story + 获取 chain
  ↓
route.ts:49-69    一致性检查 + 时间轴检查
  ↓
route.ts:72-101   调用 buildFullPrompt() 构建 prompt
  ↓
route.ts:114-118  调用 callAIText() 发送到 AI API
  ↓
route.ts:128-143  角色发现与注册 (characterManager.discoverAndRegisterCharacters)
  ↓
route.ts:145-153  乐观锁检查（防止并发冲突）
  ↓
route.ts:155-169  创建新 segment (prisma.storySegment.create)
  ↓
route.ts:171-177  异步：角色状态推断 (characterManager.inferAndUpdateStatesForSegment)
  ↓
route.ts:180-186  await：场景状态更新 (directorManager.updateSceneState)
  ↓
route.ts:189-195  异步：事件提取 (EventTracker.processSegment)
  ↓
route.ts:198-228  合理性检测 (plausibilityChecker.check)
  ↓
route.ts:230-236  返回结果 { success, segment, warnings, plausibility }
```

---

## 二、生图（AI 图片生成）逻辑

### 2.1 入口 API 路由

| 路径 | 方法 | 核心职责 | 入参 | 出参 |
|------|------|---------|------|------|
| `/api/images/route.ts` | GET | 查询段落图片 | `segmentId` | `{ images: [{url, description, type, width, height, alt}] }` |
| `/api/images/generate/route.ts` | POST | **段落插图生成**（核心，200+ 行） | `{segmentId, segmentContent, style?, storyContent?, maxImages=3}` | `{ success, images: [...] }` |
| `/api/images/generate-cover/route.ts` | POST | 故事封面生成 | `{storyId, force}` | `{ success, coverImageUrl }` |
| `/api/images/style-recommend/route.ts` | POST | 风格推荐 | `{content}` | `{recommendedStyle, reason, confidence, allStyles: [...]}` |

---

### 2.2 核心逻辑

#### `src/lib/image-generator.ts`（33KB，核心生图引擎）

**底层模型**：
- 调用 OpenAI-compatible `/images/generations` 端点
- 默认模型：`dall-e-3`（通过 `AI_IMAGE_MODEL` 环境变量配置）
- 兼容 GLM/cogview/通义万相：对非 DALL-E 模型走 `b64_json` + `negative_prompt/num_inference_steps/guidance_scale/seed`

**核心函数**：`generateImagesForSegment(options)`（第 481 行）

**生成流程**：
1. **场景提取**：
   - AI 提取（`extractSceneDescriptionsWithAI`，输出英文 enPrompt）或
   - 启发式提取（`extractSceneDescriptions`）+ AI 翻译为英文
2. **风格选择**：自动或手动选择（10 种风格：写实/艺术/卡通/历史/玄幻等）
3. **参考图搜索**：`reference-image-search.ts` 搜索同人参考图（用于 Fandom 故事）
4. **角色视觉提示**：从 `character-engine` 获取角色外观描述
5. **上下文摘要**：拉近 5 段摘要作为 context
6. **Prompt 构建**：拼接镜头/光线/构图/no-text 约束 + 角色外观 + sceneState + 参考图
7. **并行生成**：`Promise.all` 并行生成（每图独立重试 + 降级占位 SVG）
8. **下载落盘**：URL 或 base64 均下载到 `public/generated-images/`
9. **写回数据库**：URL 数组写入 `prisma.storySegment.imageUrls`

**参数**：
- `maxImages`：最多生成 3 张
- `style`：风格（可选）
- `seed`：从角色 + segmentId 派生，保证一致性
- `characters`：角色视觉提示
- `contextSummary`：上下文摘要
- `sceneStateEn`：场景状态（英文）
- `referenceImages`：同人参考图

---

#### `src/lib/cover-generator.ts`（6.5KB，封面生成）

**核心函数**：`generateCoverImage(storyId, options)`

**流程**：
1. 读取故事信息 + 角色列表
2. 构建封面 prompt（标题 + 描述 + 关键角色）
3. 调用图片生成 API
4. 写入 `prisma.story.coverImageUrl`

---

#### `src/lib/image-styles.ts`（1.3KB，风格定义）

**10 种风格**：
- `realistic`（写实）、`artistic`（艺术）、`cartoon`（卡通）、`historical`（历史）、`fantasy`（玄幻）
- `ink-wash`（水墨）、`oil-painting`（油画）、`anime`（动漫）、`sketch`（素描）、`watercolor`（水彩）

**风格推荐逻辑**：
- `analyzeStoryStyle`（故事级）：基于关键词匹配（宫廷/战争/山水/宗教等）
- `analyzeSegmentStyle`（段落级覆盖）
- `autoPickStyle`：正则兜底（科幻/武侠/玄幻等）

---

### 2.3 前端触发

**组件**：`src/components/story/StoryImageDisplay.tsx`（展示 + onRegenerate 回调）

**触发位置**：
- `src/app/story/[id]/page.tsx` —— **手动触发**（续写后不会自动生成）
- `handleRegenerateImages`（第 286 行）：`POST /api/images/generate`
- 封面生成按钮（第 1197 行）：`POST /api/images/generate-cover`
- 风格选择器 `setImageStyle`（第 802 行）+ `style-recommend`（第 147 行）

---

### 2.4 存储

| 存储位置 | 字段 | 说明 |
|---------|------|------|
| PostgreSQL | `prisma.storySegment.imageUrls: String[]` | 段落插图 URL 数组，每次生成**替换**（非追加） |
| PostgreSQL | `prisma.story.coverImageUrl: String?` | 故事封面 URL |
| 本地文件 | `public/generated-images/` | 图片文件缓存目录 |
| JSON 双写 | `simple-db.ts` 的 `imageUrls / imagePrompts` | 兼容层 |

**URL 格式**：`/generated-images/<segmentId>_<i>.png`

---

### 2.5 配置（`.env.example`）

```bash
AI_IMAGE_PROVIDER=openai
AI_IMAGE_API_KEY=your_ai_image_api_key_here
AI_IMAGE_MODEL=dall-e-3
AI_IMAGE_BASE_URL=https://api.openai.com/v1
IMAGE_SIZE=512x512
IMAGE_QUALITY=standard
IMAGE_STYLES=realistic,artistic,cartoon,historical,fantasy
```

**注意**：
- 代码实际硬编码 `1024x1024`，`IMAGE_SIZE/IMAGE_QUALITY` 环境变量未被代码读取（属残留配置）
- 兼容多种模型：DALL-E、GLM/cogview、通义万相

---

## 三、总结

### 生文链路核心特点

1. **多层 Prompt 工程**：13 层堆叠，动态 token 预算，风格锚点 + 记忆提醒
2. **角色名自动纠错**：检测形近字错误（如"满穂→满穃"），防止 AI 写错低频字
3. **推理模型支持**：自动提取 `reasoning_content`，过滤思考过程
4. **全链路一致性保障**：写作前后两次一致性检查 + 时间轴校验 + 合理性检测
5. **队列与限流**：优先级队列 + 全局限流 + 指数退避重试

### 生图链路核心特点

1. **完整真实实现**（非占位）：场景提取 → 风格推荐 → 参考图搜索 → 并行生成 → 本地缓存
2. **多模型兼容**：DALL-E、GLM/cogview、通义万相
3. **Fandom 增强**：同人故事自动搜索参考图，注入视觉锚点
4. **手动触发**：前端手动按钮，续写后不自动生图
5. **本地缓存 + 数据库双存储**：图片落盘到 `public/generated-images/`，URL 存 PostgreSQL

### 新增功能（未提交到 Git）

- `auto-continue/route.ts`：批量自动续写（SSE 流式）
- `plausibility/route.ts`：合理性检测独立端点
- `debug-prompt/route.ts`：Prompt 调试工具
- `character-extractor.ts`：严格人名提取
- `plausibility-checker.ts`：AI 合理性检测引擎

---

**调研完成时间**：2026-06-13
**调研范围**：生文 API 路由 5 个 + 核心库 10+ 个；生图 API 路由 4 个 + 核心库 3 个

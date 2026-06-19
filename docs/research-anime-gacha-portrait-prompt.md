# 动漫立绘 / Gacha Portrait 风格 Prompt 研究小结

> 调研目的:优化 `src/lib/image-generator.ts` 的 anime 风格,使其更贴合动漫互动游戏立绘(原神/明日方舟/Fate GO 等)
> 调研日期:2026-06-14

---

## 一、关键发现

### 1.1 当前 anime 模板的缺陷

当前模板(`image-generator.ts:75-76`):
```
high quality Japanese anime key visual, clean line art, vibrant cel-shading,
expressive characters, dynamic composition, Makoto Shinkai lighting
```

问题:
- "key visual" 偏向海报/视觉图,不是角色立绘
- "Makoto Shinkai lighting" 是新海诚那种**写实风景光照**,跟角色立绘的**干净轮廓 + 平涂阴影**风格相反
- 没有立绘必备要素:半身/全身构图、角色居中、简洁背景、固定姿势库、品牌化光照

### 1.2 Gacha Portrait(抽卡立绘)的视觉特征

通过分析原神/明日方舟/Fate GO/碧蓝航线等主流 gacha 游戏的官方立绘,提炼共性:

| 维度 | 特征 | 对应 prompt 关键词 |
|------|------|-------------------|
| **构图** | 角色居中,半身或全身,留白构图 | `1girl/1boy, solo, upper body OR full body, centered composition, looking at viewer` |
| **轮廓** | 清晰黑色描边(线稿强化) | `clean line art, thick outlines, inked lines` |
| **上色** | 赛璐璐(色块平涂 + 简单阴影分层) | `cel shading, flat color, limited color palette, hard shadows` |
| **背景** | 单色/渐变/抽象图案,不抢戏 | `simple background, gradient background, abstract background, white background` |
| **光照** | 软光 + 边缘光(rim light)勾勒轮廓,无复杂环境光 | `soft lighting, rim light, clean shading, no ambient occlusion` |
| **姿势** | 三七分站姿、回头、武器姿态(动态但稳定) | `dynamic standing pose, three-quarter view, hand on hip` |
| **细节** | 服装华丽、配饰精致、表情明确 | `detailed clothing, ornate accessories, expressive eyes` |
| **品牌特征** | 各厂有标志风格(mihoyo/鹰角/type-moon) | `miHoYo style / Arknights style / TYPE-MOON style` |

### 1.3 CogView / GLM 系模型的偏好(关键!)

你用的是 `glm-image`(智谱 CogView 系列),研究显示:

- **CogView4 原生支持中文**,但当前代码强制走英文 prompt(`enforceNoTextInPrompt` 剥中文)
- CogView 对 **Danbooru 标签 + 自然语言混合**响应好,不是纯 booru 标签
- **质量元标签**应该放在 prompt **开头**:`masterpiece, best quality, highres`
- 艺术风格标签紧跟其后,主体描述在中间,环境/光照在后

### 1.4 Prompt 结构公式(适配 CogView)

```
[质量元标签] + [艺术风格 + 厂商风格] + [主体: 角色描述/姿势] +
[服装/配饰] + [构图: 居中/半身/全身] + [背景] + [光照] + [no-text 约束]
```

---

## 二、本次代码改动方案

### 2.1 改造范围

只动 `src/lib/image-generator.ts` 的风格相关部分,不改 API 路由、不改前端、不改 prompt-builder。

### 2.2 具体改动

#### 改动 1:重写 `STYLE_TEMPLATES.anime`

从"日漫 key visual + 新海诚光照"改为"gacha portrait + cel shading + 干净背景"。

#### 改动 2:新增 `gacha-portrait` 风格

专门用于抽卡立绘,作为同人/动漫/游戏题材的默认风格。

#### 改动 3:调整 `autoPickStyle`

让"同人/动漫/游戏"关键词命中 `gacha-portrait` 而非泛化的 `anime`。

#### 改动 4:质量元标签前置

在 `callImageAPI` 或 prompt 组装处,确保 `masterpiece, best quality` 在 prompt 开头(CogView 偏好)。

#### 改动 5:修复空 genre/description 兜底

之前发现的 bug——`genre: , story context: ,` 空字段会让 prompt 退化。改成不输出空字段。

### 2.3 不做的事

- 不改 `enforceNoTextInPrompt`(CJK 抑制逻辑对 cogview 仍必要,因为用户故事是中文,如果不剥中文会画进画面)
- 不引入 LoRA/外部模型(智谱 API 不支持自定义权重)
- 不改 API 接口签名(向后兼容)

---

## 三、来源

- [NovelAI Diffusion Anime Art Style 教程](https://docs.novelai.net/en/image/tutorial-artstyles/) — 艺术风格标签应靠近 prompt 开头
- [Cel Shading Prompts - Stable Diffusion Online](https://stablediffusionweb.com/prompts/cel-shading) — cel shading prompt 数据库
- [PromptHero Cel Shading](https://prompthero.com/search?q=cel+shading) — 大量 cel shading 参考图
- [TYPE-MOON 角色再现标签 - NovelAI Wiki](https://seesaawiki.jp/nai_ch/d/%25C8%25C7%25B8%25A2%25C8%25C7%25B8%25A2%25A5%25AD%25C5%25EA%25A5%25E9%25BA%25C6%25B8%25BD/TYPE-MOON) — Fate GO 角色标签写法
- [智谱 AI 提示词工程官方文档](https://docs.bigmodel.cn/cn/guide/platform/prompt) — CogView 模型专属 prompt 指南
- [AUTOMATIC1111 SD WebUI 中文 FAQ](https://gist.github.com/crosstyan/f912612f4c26e298feec4a2924c41d99) — prompt 结构最佳实践
- [Tensor.Art FATE 模型集合](https://tensor.art/models/tag/611873646994210820) — FGO 风格 LoRA 参考
- [Reddit: gachagaming on cel shading trend](https://www.reddit.com/r/gachagaming/comments/11m34e4/) — gacha 游戏视觉趋势讨论
- [BooruTagCart - Danbooru 标签助手](https://github.com/xhoxye/BooruTagCart) — 动漫标签查询工具

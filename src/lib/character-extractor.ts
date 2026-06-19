/**
 * AI 角色名提取器
 *
 * 在续写完成后，使用 AI 从文本中准确提取角色名。
 * 比启发式规则更准确，能理解上下文。
 */

import { extractJsonFromAI } from './ai-client';

export interface ExtractedCharacter {
  name: string;
  aliases?: string[];  // 别名、小名、代号
  role?: 'protagonist' | 'antagonist' | 'supporting' | 'minor';
  confidence: number;  // 0-1，AI 对这是角色的确信度
}

/**
 * 使用 AI 从文本中提取角色名
 *
 * @param text 要提取的文本（通常是段落内容）
 * @param callAIFn AI 调用函数
 * @param context 上下文信息（标题、已有角色等）
 */
export async function extractCharactersWithAI(
  text: string,
  callAIFn: (prompt: string) => Promise<string>,
  context?: {
    title?: string;
    description?: string;
    existingNames?: string[];  // 已知角色名，避免重复提取
  },
): Promise<ExtractedCharacter[]> {
  if (!text || text.trim().length === 0) {
    return [];
  }

  const existingHint = context?.existingNames?.length
    ? `\n已知角色（不要重复列出）：${context.existingNames.join('、')}`
    : '';

  const prompt = `你是文学分析助手。请从下面这段中文文本中，提取所有"人物角色"的名字。

要求：
1. 只提取真正的"人物角色名"（完整姓名、别名、小名、代号）
2. 不要提取：地名、组织名、物品名、动物名、形容词、动词短语、比喻中的物象
3. "白芦如雪"是比喻，"白马"是马的描述，"于河"是介词+地名，这些都不是人名
4. "荆轲刺秦"是动作短语，不是人名；人名是"荆轲"
5. 对于每个角色，给出确信度（0-1）：1=绝对是角色，0.5=可能是角色，0=不确定

故事标题：${context?.title || '未知'}
故事简介：${(context?.description || '').slice(0, 200)}${existingHint}

文本：
${text.slice(0, 3000)}

严格输出 JSON 数组，不要 markdown，不要解释：
[
  {
    "name": "角色最常用的称呼",
    "aliases": ["别名1", "别名2"],
    "role": "protagonist | antagonist | supporting | minor",
    "confidence": 0.0-1.0
  }
]

如果没有人物角色，输出：[]`;

  try {
    const raw = await callAIFn(prompt);
    const parsed = extractJsonFromAI<ExtractedCharacter[]>(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    // 过滤和验证
    return parsed
      .filter(item => {
        // 必须有名字
        if (!item.name || typeof item.name !== 'string') return false;
        // 名字必须是中文
        if (!/[一-鿿]/.test(item.name)) return false;
        // 名字长度合理
        if (item.name.length < 2 || item.name.length > 20) return false;
        // 确信度足够高
        if ((item.confidence ?? 0) < 0.5) return false;
        // 不在排除列表中
        if (context?.existingNames?.includes(item.name.trim())) return false;
        return true;
      })
      .map(item => ({
        name: item.name.trim(),
        aliases: (item.aliases || []).map(a => a.trim()).filter(Boolean),
        role: item.role || 'supporting',
        confidence: item.confidence || 0.5,
      }));
  } catch (e) {
    console.warn('[character-extractor] AI 提取失败:', e);
    return [];
  }
}

/**
 * 快速提取角色名（只返回名字列表）
 * 用于 prompt-builder 中的冷启动兜底
 */
export async function extractCharacterNamesQuick(
  text: string,
  callAIFn: (prompt: string) => Promise<string>,
  existingNames?: string[],
): Promise<string[]> {
  const characters = await extractCharactersWithAI(text, callAIFn, { existingNames });
  return characters.map(c => c.name);
}

/**
 * 改进的启发式提取（作为 AI 提取失败时的兜底）
 * 比原来的 extractPersonNames 更严格
 */
export function extractPersonNamesStrict(text: string): string[] {
  const surnames = '赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏窦章苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫经房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍卻璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾母沙乜养鞠须丰巢关蒯相查后荆红游竺权逯盖益桓公';
  const surnameSet = new Set<string>();
  for (const ch of surnames) surnameSet.add(ch);

  // 常见地名（用于过滤）
  const placeNames = new Set([
    '易水', '渭水', '汉水', '淮水', '长江', '黄河', '洛水', '汾水', '湘水', '汉江',
    '咸阳', '长安', '洛阳', '蓟城', '邯郸', '大梁', '临淄', '郢都', '蓟', '燕', '秦', '赵', '魏', '韩', '齐', '楚',
    '函谷', '武关', '潼关', '雁门', '云中', '陇西', '北地', '上郡', '督亢', '秦庭', '秦宫',
    '河畔', '河', '水', '山', '原', '野', '庭', '宫', '殿', '阙', '门', '关',
  ]);

  // 常见非人名词汇（植物、动物、物品、颜色+名词组合）
  const nonNameWords = new Set([
    // 拟声词和形容词
    '萧萧', '瑟瑟', '凄凄', '茫茫', '苍苍', '悠悠', '浩浩', '荡荡',
    '飘飘', '纷纷', '扬扬', '漫漫', '沉沉', '隐隐', '隆隆', '轰轰',
    // 颜色+名词组合（不是人名）
    '白马', '黑马', '红马', '青马', '素衣', '白衣', '黑衣', '红衣',
    '白芦', '红芦', '青芦', '黄芦', '白雪', '红雪',
    // 介词+名词组合
    '于河', '于河畔', '于山', '于野', '于庭',
    // 常见物品
    '匕首', '宝剑', '长剑', '短剑', '地图', '图卷',
    // 常见疑问词/虚词组合
    '何以', '何为', '何能', '何不', '何故', '何如',
    '宗庙', '社稷', '天下', '江山', '朝廷', '宫阙',
    // 常见误提取
    '虎狼', '孱弱', '王虎', '国孱', '宗庙社', '王虎狼',
    // 动词短语误提取
    '荆轲勒', '马回', '马回望', '步上前', '双手', '双手按', '趋步',
    '按剑', '登车', '勒马', '趋步上前',
  ]);

  // 动词后缀
  const verbSuffixes = new Set([
    '刺', '杀', '伐', '攻', '守', '战', '击', '破', '灭', '亡',
    '走', '逃', '追', '赶', '来', '去', '入', '出', '上', '下',
    '登', '立', '坐', '卧', '行', '跑', '飞', '游', '骑', '驾',
    '勒', '按', '趋', '望', '前',
  ]);

  // 常见非人名模式
  const nonNamePatterns = [
    /^.{0,2}[如若虽虽但是而又或且]$/,  // 虚词结尾
    /^[这那此其每各哪什么如何若虽但是而又]$/,  // 指示代词开头
    /^.{0,2}[之乎者矣焉哉]$/,  // 文言虚词
    /^于/,  // "于"开头的通常是介词短语
    /^白[马牛羊猪鸡鸭鹅芦花草树雪]$/,  // 颜色+动物/植物
    /^何[以为何故如不]$/,  // 疑问词
    /^宗[庙社]$/,  // 宗庙相关
    /^社[稷会]$/,  // 社稷相关
    /^双[手足眼耳]$/,  // 双手、双足等身体部位
    /^步[上前下后]$/,  // 步上、步前等动作
    /^马[回回望走走]$/,  // 马回、马走等动作
    /勒$/,  // 以"勒"结尾（勒马）
    /望$/,  // 以"望"结尾（回望）
  ];

  // 常见形容词/名词后缀，如果名字以这些结尾，很可能是误提取
  const suspectSuffixes = new Set([
    '虎狼', '孱弱', '何以', '宗庙', '社稷', '天下', '江山',
    '朝廷', '宫阙', '殿陛', '宗庙', '社稷',
  ]);

  const names = new Set<string>();
  const nonNameChars = new Set('的了是在有这我你他她它们和与而但就把给对让用都能会要已将又可该当为因为所其地得着');

  for (let i = 0; i < text.length; i++) {
    if (!surnameSet.has(text[i])) continue;

    // 只尝试 2-3 字（4 字几乎不可能是人名）
    for (const len of [2, 3]) {
      if (i + len > text.length) continue;
      const candidate = text.slice(i, i + len);
      const namePart = candidate.slice(1);

      if (!namePart) continue;
      if (/[^一-鿿]/.test(namePart)) continue;
      if ([...namePart].some(ch => nonNameChars.has(ch))) continue;

      // 过滤规则
      if (verbSuffixes.has(candidate[candidate.length - 1])) continue;
      if (placeNames.has(candidate)) continue;
      if (nonNameWords.has(candidate)) continue;
      if (suspectSuffixes.has(candidate)) continue;

      // 检查是否以可疑后缀结尾
      let endsWithSuspect = false;
      for (const suffix of suspectSuffixes) {
        if (candidate.endsWith(suffix)) {
          endsWithSuspect = true;
          break;
        }
      }
      if (endsWithSuspect) continue;

      // 检查是否以地名开头
      let startsWithPlace = false;
      for (const place of placeNames) {
        if (candidate.startsWith(place)) {
          startsWithPlace = true;
          break;
        }
      }
      if (startsWithPlace) continue;

      // 检查非人名模式
      let matchesNonNamePattern = false;
      for (const pattern of nonNamePatterns) {
        if (pattern.test(candidate)) {
          matchesNonNamePattern = true;
          break;
        }
      }
      if (matchesNonNamePattern) continue;

      // 特殊处理："徐夫人" 是人名，但 "徐夫" 不是
      if (candidate === '徐夫') continue;

      names.add(candidate);
    }
  }

  return [...names];
}

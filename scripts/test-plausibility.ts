/**
 * 测试合理性检测功能
 */

import prisma from '../src/lib/prisma';
import { getOrderedChain } from '../src/lib/chain-helpers';
import { plausibilityChecker } from '../src/lib/plausibility-checker';
import { callAIText } from '../src/lib/ai-client';
import { characterManager } from '../src/lib/character-engine';

const STORY_ID = 'cmp6jv9zr007luj7f5ho8owt6'; // 原神钟离故事
const BRANCH_ID = 'main';

async function testPlausibility() {
  console.log('='.repeat(60));
  console.log('测试合理性检测功能');
  console.log('='.repeat(60));

  try {
    // 1. 获取故事信息
    console.log('\n1. 获取故事信息...');
    const story = await prisma.story.findUnique({ where: { id: STORY_ID } });
    if (!story) {
      console.error('故事不存在');
      return;
    }
    console.log(`   标题: ${story.title}`);
    console.log(`   类型: ${story.genre}`);

    // 2. 获取段落链
    console.log('\n2. 获取段落链...');
    const chain = await getOrderedChain(STORY_ID, BRANCH_ID);
    console.log(`   段落数量: ${chain.length}`);

    if (chain.length === 0) {
      console.log('没有段落可检测');
      return;
    }

    // 3. 获取最后一段作为检测目标
    const lastSegment = chain[chain.length - 1];
    const existingContent = chain.slice(0, -1).map(s => s.content).join('\n');
    console.log(`   检测段落: ${lastSegment.title || lastSegment.id}`);
    console.log(`   段落内容预览: ${lastSegment.content.slice(0, 100)}...`);

    // 4. 获取角色列表
    console.log('\n3. 获取角色列表...');
    const characters = await characterManager.list(STORY_ID);
    const characterNames = characters.map(c => c.name);
    console.log(`   角色列表: ${characterNames.join(', ')}`);

    // 5. 执行合理性检测
    console.log('\n4. 执行合理性检测...');
    const report = await plausibilityChecker.check({
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
      genre: story.genre ?? undefined,
      existingContent,
      newContent: lastSegment.content,
      characterNames,
    }, (p: string) => callAIText(p, { maxTokens: 1500, story: story as any }));

    // 6. 输出结果
    console.log('\n' + '='.repeat(60));
    console.log('检测结果');
    console.log('='.repeat(60));
    console.log(`\n整体评分: ${report.overallScore}/100`);
    console.log(`是否合理: ${report.isPlausible ? '是' : '否'}`);
    console.log(`总结: ${report.summary}`);
    console.log(`\n发现问题: ${report.issues.length} 个`);

    if (report.issues.length > 0) {
      console.log('\n问题详情:');
      report.issues.forEach((issue, idx) => {
        console.log(`\n[${idx + 1}] ${issue.title}`);
        console.log(`    维度: ${issue.dimension}`);
        console.log(`    严重程度: ${issue.severity}`);
        console.log(`    描述: ${issue.description}`);
        if (issue.evidence) {
          console.log(`    证据: ${issue.evidence}`);
        }
        if (issue.suggestion) {
          console.log(`    建议: ${issue.suggestion}`);
        }
      });
    }

    console.log('\n' + '='.repeat(60));
    console.log('测试完成！');
    console.log('='.repeat(60));

  } catch (error) {
    console.error('测试失败:', error);
  } finally {
    await prisma.$disconnect();
  }
}

testPlausibility();

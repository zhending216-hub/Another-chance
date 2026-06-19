/**
 * 测试续写功能 - 验证新的 AI 角色提取
 */

import prisma from '../src/lib/prisma';
import { getOrderedChain } from '../src/lib/chain-helpers';
import { buildFullPrompt } from '../src/lib/prompt-builder';
import { callAIText } from '../src/lib/ai-client';
import { characterManager } from '../src/lib/character-engine';

const STORY_ID = 'cmo6ubblf0008jkdnwretf9gu';
const BRANCH_ID = 'main';

async function testContinue() {
  console.log('='.repeat(60));
  console.log('测试续写功能 - 验证 AI 角色提取');
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

    // 2. 获取当前段落链
    console.log('\n2. 获取当前段落链...');
    const chain = await getOrderedChain(STORY_ID, BRANCH_ID);
    console.log(`   段落数量: ${chain.length}`);
    const tailSegment = chain[chain.length - 1];
    console.log(`   最后段落ID: ${tailSegment.id}`);

    // 3. 检查已注册角色
    console.log('\n3. 检查已注册角色...');
    const existingChars = await characterManager.list(STORY_ID);
    console.log(`   已注册角色数量: ${existingChars.length}`);
    if (existingChars.length > 0) {
      console.log(`   角色列表: ${existingChars.map(c => c.name).join(', ')}`);
    }

    // 4. 构建 Prompt 并查看角色名提取
    console.log('\n4. 构建 Prompt...');
    const result = await buildFullPrompt({
      storyId: STORY_ID,
      branchId: BRANCH_ID,
      tailSegment: tailSegment as any,
      chain: chain as any,
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
    });

    console.log(`   Prompt 长度: ${result.prompt.length} 字符`);
    console.log(`   已知角色名: ${result.knownCharacterNames.join(', ') || '(无)'}`);
    console.log(`   已注册角色名: ${result.registeredCharacterNames.join(', ') || '(无)'}`);

    // 5. 调用 AI 续写
    console.log('\n5. 调用 AI 续写...');
    const aiResponse = await callAIText(result.prompt, {
      systemPrompt: '你是一位擅长中国历史题材的文学作家。请用中文回答，保持与前文的风格和情节连续性。',
      maxTokens: 500,
      story: story as any,
    });
    console.log(`   AI 响应长度: ${aiResponse?.length || 0} 字符`);
    console.log(`   AI 响应预览: ${aiResponse?.slice(0, 100)}...`);

    // 6. 使用 AI 提取角色
    console.log('\n6. 使用 AI 提取角色...');
    const mentionedChars = await characterManager.discoverAndRegisterCharacters(
      STORY_ID,
      aiResponse,
      (p: string) => callAIText(p, { maxTokens: 1000, story: story as any }),
      {
        genre: story.genre ?? undefined,
        storyDescription: story.description ?? undefined,
      },
    );
    console.log(`   提取到的角色: ${mentionedChars.map(c => c.name).join(', ') || '(无)'}`);

    // 7. 再次检查已注册角色
    console.log('\n7. 再次检查已注册角色...');
    const updatedChars = await characterManager.list(STORY_ID);
    console.log(`   已注册角色数量: ${updatedChars.length}`);
    if (updatedChars.length > 0) {
      console.log(`   角色列表: ${updatedChars.map(c => c.name).join(', ')}`);
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

testContinue();

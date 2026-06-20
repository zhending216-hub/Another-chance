/**
 * Prompt 生成效果测试脚本
 * 用于检查 buildFullPrompt 的实际输出
 */

import { buildFullPrompt } from '../src/lib/prompt-builder';
import prisma from '../src/lib/prisma';

async function testPromptGeneration() {
  try {
    // 查找一个有内容的故事
    const story = await prisma.story.findFirst({
      where: {
        segments: { some: {} }
      },
      include: {
        segments: {
          take: 10,
          orderBy: { createdAt: 'asc' }
        }
      }
    });

    if (!story) {
      console.log('❌ 没有找到任何故事');
      return;
    }

    console.log('='.repeat(80));
    console.log('📚 测试故事:', story.title);
    console.log('📖 Genre:', story.genre || '(未设置)');
    console.log('📝 Description:', story.description?.slice(0, 100) || '(无)');
    console.log('='.repeat(80));

    // 获取主分支的段落链
    const segments = await prisma.storySegment.findMany({
      where: {
        storyId: story.id,
        branchId: 'main'
      },
      orderBy: { createdAt: 'asc' }
    });

    if (segments.length === 0) {
      console.log('❌ 该故事没有主分支段落');
      return;
    }

    const chain = segments;
    const tailSegment = chain[chain.length - 1];

    console.log('\n📊 段落链信息:');
    console.log(`  - 总段落数: ${chain.length}`);
    console.log(`  - 尾段落ID: ${tailSegment.id}`);
    console.log(`  - 尾段落标题: ${tailSegment.title || '(无标题)'}`);
    console.log(`  - 尾段落内容长度: ${tailSegment.content.length} 字符`);

    // 测试1: 默认 prompt
    console.log('\n' + '='.repeat(80));
    console.log('🧪 测试 1: 默认 Prompt 生成');
    console.log('='.repeat(80));

    const result1 = await buildFullPrompt({
      storyId: story.id,
      branchId: 'main',
      tailSegment: tailSegment as any,
      chain: chain as any,
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
    });

    console.log('\n📋 生成的 Prompt:');
    console.log('-'.repeat(80));
    console.log(result1.prompt);
    console.log('-'.repeat(80));
    console.log(`\n📊 Prompt 统计:`);
    console.log(`  - 总长度: ${result1.prompt.length} 字符`);
    console.log(`  - 已知角色名: ${result1.knownCharacterNames.join(', ') || '(无)'}`);
    console.log(`  - 注册角色名: ${result1.registeredCharacterNames.join(', ') || '(无)'}`);

    // 测试2: 带 pacingConfig 的 prompt
    console.log('\n' + '='.repeat(80));
    console.log('🧪 测试 2: 带 PacingConfig 的 Prompt');
    console.log('='.repeat(80));

    const result2 = await buildFullPrompt({
      storyId: story.id,
      branchId: 'main',
      tailSegment: tailSegment as any,
      chain: chain as any,
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
      pacingConfig: {
        pace: 'detailed',
        mood: 'tense',
        maxLinesPerStep: 3,
      }
    });

    console.log('\n📋 带 PacingConfig 的 Prompt:');
    console.log('-'.repeat(80));
    console.log(result2.prompt.slice(0, 1000) + '\n...(截断)');
    console.log('-'.repeat(80));

    // 测试3: 分支续写 prompt
    console.log('\n' + '='.repeat(80));
    console.log('🧪 测试 3: 分支续写 Prompt');
    console.log('='.repeat(80));

    const result3 = await buildFullPrompt({
      storyId: story.id,
      branchId: 'branch-1',
      tailSegment: tailSegment as any,
      chain: chain as any,
      storyTitle: story.title,
      storyDescription: story.description ?? undefined,
      branchMode: 'branchCreation',
      branchDirection: '主角做出不同的选择',
    });

    console.log('\n📋 分支续写 Prompt:');
    console.log('-'.repeat(80));
    console.log(result3.prompt.slice(0, 1000) + '\n...(截断)');
    console.log('-'.repeat(80));

    // 分析 prompt 结构
    console.log('\n' + '='.repeat(80));
    console.log('📊 Prompt 结构分析');
    console.log('='.repeat(80));

    const prompt = result1.prompt;
    const sections = prompt.split('\n\n');

    console.log(`\n总段落数: ${sections.length}`);
    sections.forEach((section, i) => {
      const preview = section.slice(0, 60).replace(/\n/g, ' ');
      console.log(`  ${i + 1}. [${section.length}字] ${preview}...`);
    });

  } catch (error) {
    console.error('❌ 测试失败:', error);
    if (error instanceof Error) {
      console.error(error.stack);
    }
  } finally {
    await prisma.$disconnect();
  }
}

testPromptGeneration();

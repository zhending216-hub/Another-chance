import { generateImagesForSegment } from '../src/lib/image-generator';

async function main() {
  const style = (process.argv[2] || 'gacha-portrait') as any;
  console.log(`=== 测试生图 [风格: ${style}] ===`);

  const result = await generateImagesForSegment({
    segmentId: `test-${style}-${Date.now()}`,
    segmentContent: '佐助站在悬崖边，风扬起他的黑色长发，手中握着草薙剑，目光冷峻地望着远方的火之国。',
    style,
    maxImages: 1,
    genre: '同人',
    storyDescription: '火影忍者同人故事，宇智波佐助的复仇之旅',
  });

  console.log('\n=== 结果 ===');
  for (const img of result) {
    console.log(`URL: ${img.url}`);
    console.log(`描述: ${img.description}`);
    console.log(`类型: ${img.type}`);
    console.log(`Prompt:\n${img.prompt}`);
  }
}

main();

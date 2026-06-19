import prisma from '@/lib/prisma';
import { convertStoryTreeToVNGraph, selectSampleStoryForVNMigration } from '@/lib/vn/tree-migration';

async function main() {
  const args = new Set(process.argv.slice(2));
  const storyId = readArg('--story');
  const persist = args.has('--persist');

  const input = await selectSampleStoryForVNMigration(storyId);
  const result = convertStoryTreeToVNGraph(input);

  console.log(JSON.stringify({
    storyId: result.storyId,
    title: input.story.title,
    segmentCount: result.segmentCount,
    branchCount: result.branchCount,
    nodeCount: result.graph.Nodes.length,
    valid: result.validation.valid,
    error: result.validation.error,
    mode: persist ? 'persist' : 'dry-run',
  }, null, 2));

  if (!result.validation.valid) {
    process.exitCode = 1;
    return;
  }

  if (persist) {
    const chapter = await prisma.generatedVNChapter.create({
      data: {
        storyId: result.storyId,
        branchId: 'migration-sample',
        sourceSegmentId: input.story.rootSegmentId,
        graphJson: result.graph as any,
        rawAIText: null,
        status: 'valid',
        validationError: null,
        repairAttempts: 0,
        createdById: input.story.ownerId,
      },
    });
    console.log(JSON.stringify({ persistedChapterId: chapter.id }, null, 2));
  }
}

function readArg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { execSync } from 'child_process';
import prisma from '@/lib/prisma';
import {
  generateAIVNFusionQualityReport,
  writeAIVNFusionQualityMarkdown,
  writeAIVNFusionQualityReport,
} from '@/lib/vn/fusion-quality-report';

async function main() {
  const args = process.argv.slice(2);
  const out = readArg(args, '--out');
  if (!out) throw new Error('Missing required --out exports/... json path.');
  const markdown = readArg(args, '--markdown');
  const gitCommit = readGitCommit();
  const report = await generateAIVNFusionQualityReport({ gitCommit });
  const jsonPath = await writeAIVNFusionQualityReport(out, report);
  const markdownPath = markdown
    ? await writeAIVNFusionQualityMarkdown(markdown, report)
    : null;

  console.log(JSON.stringify({
    reportPath: jsonPath,
    markdownPath,
    summary: report.corpus,
    thresholds: report.thresholds,
    failureCount: report.failures.length,
  }, null, 2));
}

function readArg(args: string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(equalsPrefix));
  if (inline) return inline.slice(equalsPrefix.length);
  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

function readGitCommit(): string | null {
  try {
    return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import prisma from '@/lib/prisma';
import {
  runPhase9Audit,
  runPhase9DryRun,
  runPhase9Export,
  runPhase9Persist,
} from '@/lib/vn/phase9-skipped-migration';
import { writeMigrationReport } from '@/lib/vn/migration-report';

async function main() {
  const args = process.argv.slice(2);
  const audit = args.includes('--audit');
  const dryRun = args.includes('--dry-run');
  const persist = args.includes('--persist');
  const exportMode = args.includes('--export');
  const modeCount = [audit, dryRun, persist, exportMode].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error('Choose exactly one mode: --audit, --dry-run, --persist, or --export.');
  }

  const reportPath = readArg(args, '--report');
  if (!reportPath) throw new Error('Missing required --report exports/... path.');

  const report = audit
    ? await runPhase9Audit()
    : dryRun
      ? await runPhase9DryRun()
      : persist
        ? await runPhase9Persist({ reportPath })
        : await runPhase9Export({
            migrationRunId: requiredArg(args, '--run'),
            format: readFormat(args),
          });

  const writtenPath = await writeMigrationReport(reportPath, report as any);
  console.log(JSON.stringify({
    mode: report.mode,
    reportPath: writtenPath,
    migrationRunId: report.migrationRunId,
    summary: report.summary,
  }, null, 2));
}

function readFormat(args: string[]): 'folder' | 'zip' {
  const format = readArg(args, '--format') ?? 'folder';
  if (format !== 'folder' && format !== 'zip') throw new Error(`Invalid --format value: ${format}`);
  return format;
}

function requiredArg(args: string[], name: string): string {
  const value = readArg(args, name);
  if (!value) throw new Error(`Missing required ${name} value.`);
  return value;
}

function readArg(args: string[], name: string): string | undefined {
  const equalsPrefix = `${name}=`;
  const inline = args.find(arg => arg.startsWith(equalsPrefix));
  if (inline) return inline.slice(equalsPrefix.length);

  const index = args.indexOf(name);
  if (index < 0) return undefined;
  return args[index + 1];
}

main()
  .catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

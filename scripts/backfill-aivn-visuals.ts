import { mkdir, writeFile } from 'fs/promises';
import path from 'path';
import prisma from '@/lib/prisma';
import { resolveMigrationReportPath } from '@/lib/vn/migration-report';
import {
  runAIVNVisualBackfillAudit,
  runAIVNVisualBackfillDryRun,
  runAIVNVisualBackfillPersistExisting,
  runAIVNVisualBackfillRollbackFromReport,
} from '@/lib/vn/visual-backfill';

async function main() {
  const args = process.argv.slice(2);
  const audit = args.includes('--audit');
  const dryRun = args.includes('--dry-run');
  const persistExisting = args.includes('--persist-existing');
  const rollbackReport = readArg(args, '--rollback-report');
  const modeCount = [audit, dryRun, persistExisting, Boolean(rollbackReport)].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error('Choose exactly one mode: --audit, --dry-run, --persist-existing, or --rollback-report PATH.');
  }

  const reportPath = readArg(args, '--report');
  if (!reportPath) throw new Error('Missing required --report exports/... path.');

  const report = audit
    ? await runAIVNVisualBackfillAudit()
    : dryRun
      ? await runAIVNVisualBackfillDryRun()
      : persistExisting
        ? await runAIVNVisualBackfillPersistExisting({
            batchSize: Number(readArg(args, '--batch-size') ?? '3'),
            risk: (readArg(args, '--risk') ?? 'low') as any,
            requireBackupConfirmation: args.includes('--confirm-backed-up'),
          })
        : await runAIVNVisualBackfillRollbackFromReport(rollbackReport!);
  const writtenPath = await writeReport(reportPath, report);

  console.log(JSON.stringify({
    mode: report.mode,
    reportPath: writtenPath,
    runId: report.runId,
    summary: report.summary,
  }, null, 2));
}

async function writeReport(reportPath: string, report: unknown): Promise<string> {
  const target = resolveMigrationReportPath(reportPath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return target;
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

import prisma from '@/lib/prisma';
import {
  runBulkMigrationAudit,
  runBulkMigrationDryRun,
  runBulkMigrationPersist,
  runBulkMigrationRollback,
  type BulkMigrationPersistOptions,
} from '@/lib/vn/bulk-migration';
import { writeMigrationReport } from '@/lib/vn/migration-report';

const UNSUPPORTED_FLAGS = new Set([
  '--force',
  '--generate-assets',
  '--verify-exports',
]);

async function main() {
  const args = process.argv.slice(2);
  rejectUnsupportedFlags(args);

  const audit = args.includes('--audit');
  const dryRun = args.includes('--dry-run');
  const persist = args.includes('--persist');
  const rollbackRunId = readArg(args, '--rollback');
  const modeCount = [audit, dryRun, persist, Boolean(rollbackRunId)].filter(Boolean).length;
  if (modeCount !== 1) {
    throw new Error('Choose exactly one mode: --audit, --dry-run, --persist, or --rollback RUN_ID.');
  }

  const reportPath = readArg(args, '--report');
  if (!reportPath) {
    throw new Error('Missing required --report exports/... path.');
  }

  const report = audit
    ? await runBulkMigrationAudit()
    : dryRun
      ? await runBulkMigrationDryRun()
      : persist
        ? await runBulkMigrationPersist(readPersistOptions(args, reportPath))
        : await runBulkMigrationRollback({ migrationRunId: rollbackRunId! });
  const writtenPath = await writeMigrationReport(reportPath, report);

  console.log(JSON.stringify({
    mode: report.mode,
    reportPath: writtenPath,
    migrationRunId: 'migrationRunId' in report ? report.migrationRunId : undefined,
    summary: report.summary,
  }, null, 2));
}

function rejectUnsupportedFlags(args: string[]) {
  const unsupportedFlag = args.find(arg => UNSUPPORTED_FLAGS.has(arg));
  if (unsupportedFlag) {
    throw new Error(`${unsupportedFlag} is not supported by this bulk migration command.`);
  }
}

function readPersistOptions(args: string[], reportPath: string): BulkMigrationPersistOptions {
  const risk = readArg(args, '--risk') ?? 'low';
  if (!['low', 'medium', 'high', 'all'].includes(risk)) {
    throw new Error(`Invalid --risk value: ${risk}`);
  }

  const batchSizeRaw = readArg(args, '--batch-size') ?? '5';
  const batchSize = Number(batchSizeRaw);
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > 100) {
    throw new Error(`Invalid --batch-size value: ${batchSizeRaw}`);
  }

  return {
    risk: risk as BulkMigrationPersistOptions['risk'],
    batchSize,
    reportPath,
  };
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

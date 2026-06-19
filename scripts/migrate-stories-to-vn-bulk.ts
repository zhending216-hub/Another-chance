import prisma from '@/lib/prisma';
import { runBulkMigrationAudit, runBulkMigrationDryRun } from '@/lib/vn/bulk-migration';
import { writeMigrationReport } from '@/lib/vn/migration-report';

const MUTATING_FLAGS = new Set([
  '--persist',
  '--rollback',
  '--force',
  '--generate-assets',
  '--verify-exports',
]);

async function main() {
  const args = process.argv.slice(2);
  rejectMutatingFlags(args);

  const audit = args.includes('--audit');
  const dryRun = args.includes('--dry-run');
  if (audit === dryRun) {
    throw new Error('Choose exactly one mode: --audit or --dry-run.');
  }

  const reportPath = readArg(args, '--report');
  if (!reportPath) {
    throw new Error('Missing required --report exports/... path.');
  }

  const report = audit
    ? await runBulkMigrationAudit()
    : await runBulkMigrationDryRun();
  const writtenPath = await writeMigrationReport(reportPath, report);

  console.log(JSON.stringify({
    mode: report.mode,
    reportPath: writtenPath,
    summary: report.summary,
  }, null, 2));
}

function rejectMutatingFlags(args: string[]) {
  const mutatingFlag = args.find(arg => MUTATING_FLAGS.has(arg) || arg.startsWith('--rollback='));
  if (mutatingFlag) {
    throw new Error(`${mutatingFlag} is not supported by the read-only audit/dry-run command.`);
  }
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
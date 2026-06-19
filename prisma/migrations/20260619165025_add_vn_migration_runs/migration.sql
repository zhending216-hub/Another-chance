-- CreateTable
CREATE TABLE "vn_migration_runs" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "dryRun" BOOLEAN NOT NULL DEFAULT true,
    "storyCount" INTEGER NOT NULL DEFAULT 0,
    "segmentCount" INTEGER NOT NULL DEFAULT 0,
    "branchCount" INTEGER NOT NULL DEFAULT 0,
    "validCount" INTEGER NOT NULL DEFAULT 0,
    "invalidCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "reportPath" TEXT,
    "errorSummary" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "vn_migration_runs_pkey" PRIMARY KEY ("id")
);

-- AlterTable
ALTER TABLE "generated_vn_chapters"
ADD COLUMN "migrationRunId" TEXT,
ADD COLUMN "migrationKind" TEXT,
ADD COLUMN "sourceHash" TEXT;

-- CreateIndex
CREATE INDEX "vn_migration_runs_status_idx" ON "vn_migration_runs"("status");

-- CreateIndex
CREATE INDEX "vn_migration_runs_startedAt_idx" ON "vn_migration_runs"("startedAt");

-- CreateIndex
CREATE INDEX "generated_vn_chapters_migrationRunId_idx" ON "generated_vn_chapters"("migrationRunId");

-- CreateIndex
CREATE INDEX "generated_vn_chapters_migrationKind_idx" ON "generated_vn_chapters"("migrationKind");

-- CreateIndex
CREATE INDEX "generated_vn_chapters_storyId_migrationKind_sourceHash_idx" ON "generated_vn_chapters"("storyId", "migrationKind", "sourceHash");

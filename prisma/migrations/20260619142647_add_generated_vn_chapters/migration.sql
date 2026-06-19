-- CreateTable
CREATE TABLE "generated_vn_chapters" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sourceSegmentId" TEXT,
    "graphJson" JSONB,
    "rawAIText" TEXT,
    "status" TEXT NOT NULL DEFAULT 'valid',
    "validationError" TEXT,
    "repairAttempts" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_vn_chapters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_vn_chapters_storyId_branchId_idx" ON "generated_vn_chapters"("storyId", "branchId");

-- CreateIndex
CREATE INDEX "generated_vn_chapters_sourceSegmentId_idx" ON "generated_vn_chapters"("sourceSegmentId");

-- CreateIndex
CREATE INDEX "generated_vn_chapters_status_idx" ON "generated_vn_chapters"("status");

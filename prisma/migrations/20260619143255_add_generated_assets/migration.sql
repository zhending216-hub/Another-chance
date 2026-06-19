-- CreateTable
CREATE TABLE "generated_assets" (
    "id" TEXT NOT NULL,
    "storyId" TEXT NOT NULL,
    "chapterId" TEXT,
    "assetId" TEXT NOT NULL,
    "scopedAssetId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "publicUrl" TEXT NOT NULL,
    "localPath" TEXT,
    "mimeType" TEXT,
    "sha256" TEXT,
    "prompt" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "generated_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "generated_assets_storyId_idx" ON "generated_assets"("storyId");

-- CreateIndex
CREATE INDEX "generated_assets_chapterId_idx" ON "generated_assets"("chapterId");

-- CreateIndex
CREATE UNIQUE INDEX "generated_assets_storyId_scopedAssetId_key" ON "generated_assets"("storyId", "scopedAssetId");

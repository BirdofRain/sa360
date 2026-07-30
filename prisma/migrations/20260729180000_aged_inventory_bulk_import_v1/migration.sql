-- Aged inventory bulk CLI: source snapshot registry

CREATE TYPE "AgedInventorySourceSnapshotStatus" AS ENUM ('previewed', 'committing', 'completed', 'failed');

CREATE TABLE "AgedInventorySourceSnapshot" (
    "id" TEXT NOT NULL,
    "fileSha256" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceFormat" TEXT NOT NULL,
    "defaultNicheKey" TEXT NOT NULL,
    "sourceLane" TEXT NOT NULL DEFAULT 'aged_inventory_bulk_csv',
    "status" "AgedInventorySourceSnapshotStatus" NOT NULL DEFAULT 'previewed',
    "lotKey" TEXT,
    "inventoryLotId" TEXT,
    "importRequestId" TEXT,
    "operator" TEXT,
    "totalSourceRows" INTEGER NOT NULL DEFAULT 0,
    "parsedRows" INTEGER NOT NULL DEFAULT 0,
    "acceptedRows" INTEGER NOT NULL DEFAULT 0,
    "exactDuplicateRows" INTEGER NOT NULL DEFAULT 0,
    "quarantinedRows" INTEGER NOT NULL DEFAULT 0,
    "rejectedRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "nextRowNumber" INTEGER NOT NULL DEFAULT 1,
    "batchesCompleted" INTEGER NOT NULL DEFAULT 0,
    "summaryJson" JSONB NOT NULL DEFAULT '{}',
    "checkpointJson" JSONB NOT NULL DEFAULT '{}',
    "previewedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgedInventorySourceSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AgedInventorySourceSnapshot_fileSha256_key" ON "AgedInventorySourceSnapshot"("fileSha256");
CREATE INDEX "AgedInventorySourceSnapshot_status_createdAt_idx" ON "AgedInventorySourceSnapshot"("status", "createdAt");
CREATE INDEX "AgedInventorySourceSnapshot_defaultNicheKey_status_idx" ON "AgedInventorySourceSnapshot"("defaultNicheKey", "status");
CREATE INDEX "AgedInventorySourceSnapshot_inventoryLotId_idx" ON "AgedInventorySourceSnapshot"("inventoryLotId");
CREATE INDEX "AgedInventorySourceSnapshot_lotKey_idx" ON "AgedInventorySourceSnapshot"("lotKey");

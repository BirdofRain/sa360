-- Aged Lead Inventory Ingestion v1 (additive, stacked on lead_inventory_foundation_v1)

CREATE TYPE "LeadInventoryImportBatchStatus" AS ENUM ('previewed', 'ready', 'committed', 'blocked', 'failed', 'canceled');

CREATE TABLE "LeadInventoryImportBatch" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "lotKey" TEXT,
    "fileName" TEXT NOT NULL,
    "fileFingerprint" TEXT NOT NULL,
    "uploadedBy" TEXT,
    "operatorNote" TEXT,
    "inventoryClass" "LeadInventoryClass" NOT NULL DEFAULT 'aged',
    "exclusivityMode" "InventoryExclusivityMode" NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT,
    "sourceProvider" "SourceLeadProvider" NOT NULL,
    "sourceLane" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "invalidRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "quarantinedRows" INTEGER NOT NULL DEFAULT 0,
    "importedRows" INTEGER NOT NULL DEFAULT 0,
    "status" "LeadInventoryImportBatchStatus" NOT NULL DEFAULT 'previewed',
    "mappingJson" JSONB NOT NULL DEFAULT '{}',
    "summaryJson" JSONB NOT NULL DEFAULT '{}',
    "previewedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "inventoryLotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadInventoryImportBatch_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "LeadInventoryImportBatch_requestId_key" ON "LeadInventoryImportBatch"("requestId");
CREATE INDEX "LeadInventoryImportBatch_status_createdAt_idx" ON "LeadInventoryImportBatch"("status", "createdAt");
CREATE INDEX "LeadInventoryImportBatch_fileFingerprint_idx" ON "LeadInventoryImportBatch"("fileFingerprint");
CREATE INDEX "LeadInventoryImportBatch_inventoryLotId_idx" ON "LeadInventoryImportBatch"("inventoryLotId");

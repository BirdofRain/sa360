-- CreateEnum
CREATE TYPE "BulkLeadImportStatus" AS ENUM ('uploaded', 'parsing', 'mapping_required', 'ready_for_review', 'ready_for_simulation', 'simulation_running', 'simulation_complete', 'approved_for_delivery', 'delivery_running', 'paused', 'partial_success', 'completed', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "BulkLeadImportRowValidationStatus" AS ENUM ('pending', 'eligible', 'identity_blocked', 'duplicate_review', 'mapping_required', 'destination_blocked', 'ready_for_simulation', 'excluded', 'failed');

-- CreateEnum
CREATE TYPE "BulkLeadImportRowDuplicateStatus" AS ENUM ('none', 'within_batch_duplicate', 'source_duplicate', 'phone_email_review', 'blocked');

-- CreateEnum
CREATE TYPE "BulkLeadImportRowDeliveryStatus" AS ENUM ('pending', 'simulated', 'delivering', 'delivered', 'skipped', 'failed', 'cancelled');

-- AlterTable
ALTER TABLE "SourceLeadEvent" ADD COLUMN "bulkImportId" TEXT,
ADD COLUMN "bulkImportRowId" TEXT;

-- CreateTable
CREATE TABLE "BulkLeadImport" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "sourceProvider" "SourceLeadProvider" NOT NULL DEFAULT 'manual_import',
    "sourceSystem" "SourceLeadSystem" NOT NULL DEFAULT 'csv_import',
    "sourceType" "SourceLeadType" NOT NULL DEFAULT 'bulk_import',
    "importLabel" TEXT,
    "status" "BulkLeadImportStatus" NOT NULL DEFAULT 'uploaded',
    "uploadedBy" TEXT,
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "parsedRows" INTEGER NOT NULL DEFAULT 0,
    "validRows" INTEGER NOT NULL DEFAULT 0,
    "blockedRows" INTEGER NOT NULL DEFAULT 0,
    "duplicateRows" INTEGER NOT NULL DEFAULT 0,
    "reviewRows" INTEGER NOT NULL DEFAULT 0,
    "simulatedRows" INTEGER NOT NULL DEFAULT 0,
    "deliveredRows" INTEGER NOT NULL DEFAULT 0,
    "failedRows" INTEGER NOT NULL DEFAULT 0,
    "destinationClientAccountId" TEXT,
    "destinationLocationIdGhl" TEXT,
    "sourceRouteKey" TEXT,
    "mappingJson" JSONB,
    "defaultValuesJson" JSONB,
    "enrichmentPolicyJson" JSONB,
    "importOptionsJson" JSONB,
    "wizardStepJson" JSONB,
    "approvedAt" TIMESTAMP(3),
    "approvedBy" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "failureSummaryJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkLeadImport_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkLeadImportRow" (
    "id" TEXT NOT NULL,
    "bulkImportId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "rawRowJson" JSONB NOT NULL,
    "normalizedPhone" TEXT,
    "normalizedEmail" TEXT,
    "sourceLeadId" TEXT,
    "sourceLeadIdGenerated" BOOLEAN NOT NULL DEFAULT false,
    "sourceLeadEventId" TEXT,
    "validationStatus" "BulkLeadImportRowValidationStatus" NOT NULL DEFAULT 'pending',
    "duplicateStatus" "BulkLeadImportRowDuplicateStatus" NOT NULL DEFAULT 'none',
    "deliveryStatus" "BulkLeadImportRowDeliveryStatus" NOT NULL DEFAULT 'pending',
    "errorCode" TEXT,
    "errorSummary" TEXT,
    "blockerReasonsJson" JSONB,
    "duplicateCandidatesJson" JSONB,
    "ghlContactId" TEXT,
    "ghlOpportunityId" TEXT,
    "excluded" BOOLEAN NOT NULL DEFAULT false,
    "deliveryAttempts" INTEGER NOT NULL DEFAULT 0,
    "lastDeliveryAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkLeadImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BulkLeadImportMappingTemplate" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sourceLabel" TEXT,
    "mappingJson" JSONB NOT NULL,
    "createdBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BulkLeadImportMappingTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SourceLeadEvent_bulkImportId_idx" ON "SourceLeadEvent"("bulkImportId");

-- CreateIndex
CREATE INDEX "BulkLeadImport_status_createdAt_idx" ON "BulkLeadImport"("status", "createdAt");

-- CreateIndex
CREATE INDEX "BulkLeadImport_destinationClientAccountId_idx" ON "BulkLeadImport"("destinationClientAccountId");

-- CreateIndex
CREATE INDEX "BulkLeadImport_createdAt_idx" ON "BulkLeadImport"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BulkLeadImportRow_bulkImportId_rowNumber_key" ON "BulkLeadImportRow"("bulkImportId", "rowNumber");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_bulkImportId_validationStatus_idx" ON "BulkLeadImportRow"("bulkImportId", "validationStatus");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_bulkImportId_deliveryStatus_idx" ON "BulkLeadImportRow"("bulkImportId", "deliveryStatus");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_bulkImportId_excluded_idx" ON "BulkLeadImportRow"("bulkImportId", "excluded");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_sourceLeadId_idx" ON "BulkLeadImportRow"("sourceLeadId");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_sourceLeadEventId_idx" ON "BulkLeadImportRow"("sourceLeadEventId");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_normalizedPhone_idx" ON "BulkLeadImportRow"("normalizedPhone");

-- CreateIndex
CREATE INDEX "BulkLeadImportRow_normalizedEmail_idx" ON "BulkLeadImportRow"("normalizedEmail");

-- CreateIndex
CREATE INDEX "BulkLeadImportMappingTemplate_name_idx" ON "BulkLeadImportMappingTemplate"("name");

-- AddForeignKey
ALTER TABLE "BulkLeadImportRow" ADD CONSTRAINT "BulkLeadImportRow_bulkImportId_fkey" FOREIGN KEY ("bulkImportId") REFERENCES "BulkLeadImport"("id") ON DELETE CASCADE ON UPDATE CASCADE;

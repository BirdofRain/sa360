-- Lead Inventory Foundation v1 (additive)

-- CreateEnum
CREATE TYPE "InventoryLotStatus" AS ENUM ('draft', 'ingesting', 'active', 'paused', 'exhausted', 'quarantined', 'archived');
CREATE TYPE "LeadInventoryClass" AS ENUM ('fresh', 'aged', 'recycled', 'referral', 'imported', 'purchased');
CREATE TYPE "InventoryExclusivityMode" AS ENUM ('exclusive', 'shared', 'configurable');
CREATE TYPE "LeadInventoryItemStatus" AS ENUM ('pending_review', 'available', 'reserved', 'committed', 'fulfilled', 'quarantined', 'expired', 'withdrawn');
CREATE TYPE "LeadOrderLineStatus" AS ENUM ('draft', 'active', 'partially_reserved', 'reserved', 'partially_fulfilled', 'fulfilled', 'canceled');

-- CreateTable InventoryLot
CREATE TABLE "InventoryLot" (
    "id" TEXT NOT NULL,
    "lotKey" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "sourceProvider" "SourceLeadProvider" NOT NULL,
    "sourceLane" TEXT NOT NULL,
    "supplierAccountId" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "formId" TEXT,
    "externalBatchId" TEXT,
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT,
    "inventoryClass" "LeadInventoryClass" NOT NULL,
    "exclusivityMode" "InventoryExclusivityMode" NOT NULL DEFAULT 'configurable',
    "status" "InventoryLotStatus" NOT NULL DEFAULT 'draft',
    "generatedFrom" TIMESTAMP(3),
    "generatedTo" TIMESTAMP(3),
    "acquiredAt" TIMESTAMP(3),
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryLot_pkey" PRIMARY KEY ("id")
);

-- CreateTable LeadInventoryItem
CREATE TABLE "LeadInventoryItem" (
    "id" TEXT NOT NULL,
    "inventoryLotId" TEXT NOT NULL,
    "sourceLeadEventId" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "normalizedState" TEXT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT,
    "sourceProvider" "SourceLeadProvider" NOT NULL,
    "sourceLane" TEXT NOT NULL,
    "inventoryClass" "LeadInventoryClass" NOT NULL,
    "exclusivityMode" "InventoryExclusivityMode" NOT NULL DEFAULT 'configurable',
    "status" "LeadInventoryItemStatus" NOT NULL DEFAULT 'pending_review',
    "quarantineReason" TEXT,
    "availableAt" TIMESTAMP(3),
    "reservedAt" TIMESTAMP(3),
    "committedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "expiredAt" TIMESTAMP(3),
    "maxFulfillments" INTEGER NOT NULL DEFAULT 1,
    "fulfillmentCount" INTEGER NOT NULL DEFAULT 0,
    "acquisitionCostCents" INTEGER,
    "internalValueCents" INTEGER,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadInventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable LeadAgeBandDefinition
CREATE TABLE "LeadAgeBandDefinition" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "minDaysInclusive" INTEGER NOT NULL,
    "maxDaysExclusive" INTEGER,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadAgeBandDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable LeadOrderLine
CREATE TABLE "LeadOrderLine" (
    "id" TEXT NOT NULL,
    "leadOrderId" TEXT NOT NULL,
    "lineNumber" INTEGER NOT NULL,
    "displayName" TEXT,
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT,
    "requestedQuantity" INTEGER NOT NULL,
    "normalizedStatesJson" JSONB NOT NULL DEFAULT '[]',
    "ageBandKeysJson" JSONB NOT NULL DEFAULT '[]',
    "minAgeDays" INTEGER,
    "maxAgeDays" INTEGER,
    "inventoryClassesJson" JSONB NOT NULL DEFAULT '[]',
    "allowedSourceLanesJson" JSONB NOT NULL DEFAULT '[]',
    "exclusivityRequired" BOOLEAN NOT NULL DEFAULT false,
    "unitPriceCents" INTEGER,
    "lineTotalCents" INTEGER,
    "fulfillmentPriority" INTEGER NOT NULL DEFAULT 100,
    "status" "LeadOrderLineStatus" NOT NULL DEFAULT 'draft',
    "reservedQuantity" INTEGER NOT NULL DEFAULT 0,
    "fulfilledQuantity" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadOrderLine_pkey" PRIMARY KEY ("id")
);

-- AlterTable LeadAllocation
ALTER TABLE "LeadAllocation" ADD COLUMN "leadOrderLineId" TEXT;
ALTER TABLE "LeadAllocation" ADD COLUMN "leadInventoryItemId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "InventoryLot_lotKey_key" ON "InventoryLot"("lotKey");
CREATE INDEX "InventoryLot_status_inventoryClass_idx" ON "InventoryLot"("status", "inventoryClass");
CREATE INDEX "InventoryLot_sourceLane_status_idx" ON "InventoryLot"("sourceLane", "status");
CREATE INDEX "InventoryLot_nicheKey_status_idx" ON "InventoryLot"("nicheKey", "status");

CREATE UNIQUE INDEX "LeadInventoryItem_sourceLeadEventId_key" ON "LeadInventoryItem"("sourceLeadEventId");
CREATE INDEX "LeadInventoryItem_generatedAt_idx" ON "LeadInventoryItem"("generatedAt");
CREATE INDEX "LeadInventoryItem_normalizedState_idx" ON "LeadInventoryItem"("normalizedState");
CREATE INDEX "LeadInventoryItem_status_idx" ON "LeadInventoryItem"("status");
CREATE INDEX "LeadInventoryItem_inventoryLotId_status_idx" ON "LeadInventoryItem"("inventoryLotId", "status");
CREATE INDEX "LeadInventoryItem_nicheKey_normalizedState_status_idx" ON "LeadInventoryItem"("nicheKey", "normalizedState", "status");
CREATE INDEX "LeadInventoryItem_sourceLane_status_idx" ON "LeadInventoryItem"("sourceLane", "status");
CREATE INDEX "LeadInventoryItem_inventoryClass_status_idx" ON "LeadInventoryItem"("inventoryClass", "status");

CREATE UNIQUE INDEX "LeadAgeBandDefinition_version_key_key" ON "LeadAgeBandDefinition"("version", "key");
CREATE INDEX "LeadAgeBandDefinition_version_active_sortOrder_idx" ON "LeadAgeBandDefinition"("version", "active", "sortOrder");

CREATE UNIQUE INDEX "LeadOrderLine_leadOrderId_lineNumber_key" ON "LeadOrderLine"("leadOrderId", "lineNumber");
CREATE INDEX "LeadOrderLine_leadOrderId_status_idx" ON "LeadOrderLine"("leadOrderId", "status");
CREATE INDEX "LeadOrderLine_nicheKey_status_idx" ON "LeadOrderLine"("nicheKey", "status");

CREATE INDEX "LeadAllocation_leadOrderLineId_idx" ON "LeadAllocation"("leadOrderLineId");
CREATE INDEX "LeadAllocation_leadInventoryItemId_idx" ON "LeadAllocation"("leadInventoryItemId");

-- Inventory integrity CHECK constraints (additive, unmerged migration)
ALTER TABLE "LeadInventoryItem"
  ADD CONSTRAINT "LeadInventoryItem_maxFulfillments_positive_chk"
    CHECK ("maxFulfillments" > 0),
  ADD CONSTRAINT "LeadInventoryItem_fulfillmentCount_nonnegative_chk"
    CHECK ("fulfillmentCount" >= 0),
  ADD CONSTRAINT "LeadInventoryItem_fulfillmentCount_within_max_chk"
    CHECK ("fulfillmentCount" <= "maxFulfillments"),
  ADD CONSTRAINT "LeadInventoryItem_acquisitionCostCents_nonnegative_chk"
    CHECK ("acquisitionCostCents" IS NULL OR "acquisitionCostCents" >= 0),
  ADD CONSTRAINT "LeadInventoryItem_internalValueCents_nonnegative_chk"
    CHECK ("internalValueCents" IS NULL OR "internalValueCents" >= 0);

ALTER TABLE "LeadOrderLine"
  ADD CONSTRAINT "LeadOrderLine_lineNumber_positive_chk"
    CHECK ("lineNumber" > 0),
  ADD CONSTRAINT "LeadOrderLine_requestedQuantity_positive_chk"
    CHECK ("requestedQuantity" > 0),
  ADD CONSTRAINT "LeadOrderLine_reservedQuantity_nonnegative_chk"
    CHECK ("reservedQuantity" >= 0),
  ADD CONSTRAINT "LeadOrderLine_fulfilledQuantity_nonnegative_chk"
    CHECK ("fulfilledQuantity" >= 0),
  ADD CONSTRAINT "LeadOrderLine_reserved_within_requested_chk"
    CHECK ("reservedQuantity" <= "requestedQuantity"),
  ADD CONSTRAINT "LeadOrderLine_fulfilled_within_requested_chk"
    CHECK ("fulfilledQuantity" <= "requestedQuantity"),
  ADD CONSTRAINT "LeadOrderLine_minAgeDays_nonnegative_chk"
    CHECK ("minAgeDays" IS NULL OR "minAgeDays" >= 0),
  ADD CONSTRAINT "LeadOrderLine_maxAgeDays_nonnegative_chk"
    CHECK ("maxAgeDays" IS NULL OR "maxAgeDays" >= 0),
  ADD CONSTRAINT "LeadOrderLine_age_range_valid_chk"
    CHECK ("maxAgeDays" IS NULL OR "minAgeDays" IS NULL OR "maxAgeDays" >= "minAgeDays"),
  ADD CONSTRAINT "LeadOrderLine_unitPriceCents_nonnegative_chk"
    CHECK ("unitPriceCents" IS NULL OR "unitPriceCents" >= 0),
  ADD CONSTRAINT "LeadOrderLine_lineTotalCents_nonnegative_chk"
    CHECK ("lineTotalCents" IS NULL OR "lineTotalCents" >= 0);

ALTER TABLE "LeadAgeBandDefinition"
  ADD CONSTRAINT "LeadAgeBandDefinition_minDaysInclusive_nonnegative_chk"
    CHECK ("minDaysInclusive" >= 0),
  ADD CONSTRAINT "LeadAgeBandDefinition_maxDaysExclusive_gt_min_chk"
    CHECK ("maxDaysExclusive" IS NULL OR "maxDaysExclusive" > "minDaysInclusive"),
  ADD CONSTRAINT "LeadAgeBandDefinition_sortOrder_nonnegative_chk"
    CHECK ("sortOrder" >= 0);

-- AddForeignKey
ALTER TABLE "LeadInventoryItem" ADD CONSTRAINT "LeadInventoryItem_inventoryLotId_fkey" FOREIGN KEY ("inventoryLotId") REFERENCES "InventoryLot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadInventoryItem" ADD CONSTRAINT "LeadInventoryItem_sourceLeadEventId_fkey" FOREIGN KEY ("sourceLeadEventId") REFERENCES "SourceLeadEvent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "LeadOrderLine" ADD CONSTRAINT "LeadOrderLine_leadOrderId_fkey" FOREIGN KEY ("leadOrderId") REFERENCES "LeadOrder"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LeadAllocation" ADD CONSTRAINT "LeadAllocation_leadOrderLineId_fkey" FOREIGN KEY ("leadOrderLineId") REFERENCES "LeadOrderLine"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LeadAllocation" ADD CONSTRAINT "LeadAllocation_leadInventoryItemId_fkey" FOREIGN KEY ("leadInventoryItemId") REFERENCES "LeadInventoryItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default age-band configuration v1 (development baseline)
INSERT INTO "LeadAgeBandDefinition" ("id", "version", "key", "label", "minDaysInclusive", "maxDaysExclusive", "sortOrder", "active", "effectiveFrom", "updatedAt")
VALUES
  ('liab_v1_fresh_0_7', 'v1', 'FRESH_0_7', '0–7 days', 0, 8, 10, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('liab_v1_recent_8_30', 'v1', 'RECENT_8_30', '8–30 days', 8, 31, 20, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('liab_v1_aged_31_60', 'v1', 'AGED_31_60', '31–60 days', 31, 61, 30, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('liab_v1_aged_61_90', 'v1', 'AGED_61_90', '61–90 days', 61, 91, 40, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('liab_v1_aged_91_180', 'v1', 'AGED_91_180', '91–180 days', 91, 181, 50, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('liab_v1_aged_181_365', 'v1', 'AGED_181_365', '181–365 days', 181, 366, 60, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('liab_v1_aged_366_plus', 'v1', 'AGED_366_PLUS', '366+ days', 366, NULL, 70, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);

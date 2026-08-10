-- Lead Inventory facets supply snapshot v1 (additive only).
-- Partial unique index (one active build per ageBandVersion) is raw SQL;
-- Prisma schema documents the models but cannot express the partial unique.

-- CreateEnum
CREATE TYPE "LeadInventoryFacetBuildStatus" AS ENUM ('building', 'validated', 'active', 'failed', 'retired');

-- CreateTable
CREATE TABLE "LeadInventoryFacetBuild" (
    "id" TEXT NOT NULL,
    "ageBandVersion" TEXT NOT NULL,
    "evaluatedAt" TIMESTAMP(3) NOT NULL,
    "status" "LeadInventoryFacetBuildStatus" NOT NULL,
    "inventoryCount" INTEGER NOT NULL DEFAULT 0,
    "aggregateRowCount" INTEGER NOT NULL DEFAULT 0,
    "buildDurationMs" INTEGER,
    "validationOk" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "failureCode" TEXT,
    "failureDetailJson" JSONB,
    "metadataJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadInventoryFacetBuild_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadInventoryFacetSupplyAggregate" (
    "id" TEXT NOT NULL,
    "buildId" TEXT NOT NULL,
    "ageBandVersion" TEXT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "productType" TEXT NOT NULL DEFAULT '',
    "inventoryClass" TEXT NOT NULL,
    "sourceLane" TEXT NOT NULL,
    "lotId" TEXT NOT NULL,
    "itemStatus" TEXT NOT NULL,
    "normalizedState" TEXT NOT NULL,
    "ageBandKey" TEXT NOT NULL,
    "total" INTEGER NOT NULL,
    "available" INTEGER NOT NULL,
    "reserved" INTEGER NOT NULL,
    "blocked" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadInventoryFacetSupplyAggregate_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LeadInventoryFacetSupplyAggregate_nonneg_chk" CHECK (
      "total" >= 0 AND "available" >= 0 AND "reserved" >= 0 AND "blocked" >= 0
    ),
    CONSTRAINT "LeadInventoryFacetSupplyAggregate_partition_chk" CHECK (
      "total" = ("available" + "reserved" + "blocked")
    )
);

-- Indexes
CREATE INDEX "LeadInventoryFacetBuild_status_ageBandVersion_idx"
  ON "LeadInventoryFacetBuild"("status", "ageBandVersion");

CREATE INDEX "LeadInventoryFacetBuild_ageBandVersion_activatedAt_idx"
  ON "LeadInventoryFacetBuild"("ageBandVersion", "activatedAt");

CREATE INDEX "LeadInventoryFacetBuild_createdAt_idx"
  ON "LeadInventoryFacetBuild"("createdAt");

-- At most one active build per age-band version (authoritative snapshot scope).
CREATE UNIQUE INDEX "LeadInventoryFacetBuild_one_active_per_version_key"
  ON "LeadInventoryFacetBuild"("ageBandVersion")
  WHERE status = 'active';

CREATE UNIQUE INDEX "LeadInventoryFacetSupplyAggregate_grain_key"
  ON "LeadInventoryFacetSupplyAggregate"(
    "buildId",
    "ageBandVersion",
    "nicheKey",
    "productType",
    "inventoryClass",
    "sourceLane",
    "lotId",
    "itemStatus",
    "normalizedState",
    "ageBandKey"
  );

CREATE INDEX "LeadInventoryFacetSupplyAggregate_buildId_normalizedState_ageBandKey_idx"
  ON "LeadInventoryFacetSupplyAggregate"("buildId", "normalizedState", "ageBandKey");

CREATE INDEX "LeadInventoryFacetSupplyAggregate_buildId_filters_idx"
  ON "LeadInventoryFacetSupplyAggregate"(
    "buildId",
    "nicheKey",
    "inventoryClass",
    "sourceLane",
    "lotId",
    "itemStatus"
  );

CREATE INDEX "LeadInventoryFacetSupplyAggregate_ageBandVersion_buildId_idx"
  ON "LeadInventoryFacetSupplyAggregate"("ageBandVersion", "buildId");

-- ForeignKeys
ALTER TABLE "LeadInventoryFacetSupplyAggregate"
  ADD CONSTRAINT "LeadInventoryFacetSupplyAggregate_buildId_fkey"
  FOREIGN KEY ("buildId") REFERENCES "LeadInventoryFacetBuild"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

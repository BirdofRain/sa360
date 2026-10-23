-- Gate 11 historical campaign summary schema.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. prisma migrate deploy sends the file through simple_query and does
-- not wrap it. SET LOCAL therefore applies only inside this transaction, and
-- PostgreSQL rolls every object in the file back if a statement fails before
-- COMMIT. Prisma can still record that failed attempt in _prisma_migrations
-- from a later transaction; recovery is prisma migrate resolve --rolled-back
-- followed by another deploy. This file does not authorize that recovery in
-- production.
--
-- This migration creates five empty tables, the Gate 10 indexes, and one
-- control row with summary_ready = false. It does not create triggers,
-- functions, or procedures. It does not alter inventory, source events, lots,
-- the historical projection, or the projection control row. It does not
-- backfill. Catalog SQL is unchanged.
--
-- Merging this file into master makes sa360-migrate apply it on the next API
-- predeploy. The summary stays unready. This PR must stay unmerged until that
-- application is reviewed.
--
-- Prisma 6.19 cannot model UNIQUE NULLS NOT DISTINCT or these CHECK
-- constraints. The bucket @@unique in schema.prisma names the same columns so
-- a diff does not drop historical_catalog_summary_bucket_grain. If a later
-- Prisma version regenerates that constraint, keep NULLS NOT DISTINCT.
-- label_hash is indexed and is not unique. Long July text stays out of every
-- unique index.
--
-- Locks: CREATE TABLE takes ACCESS EXCLUSIVE only on the new relation, which
-- no other session can see until commit. CREATE INDEX and the control INSERT
-- run while that lock is already held. No existing inventory, projection, lot,
-- or source-event table is locked by this file. Prisma's own migration bookkeeping
-- locks _prisma_migrations, not those tables.

BEGIN;

SET LOCAL lock_timeout = '3s';

-- CreateTable
CREATE TABLE "historical_catalog_summary_label" (
    "label_pair_id" BIGSERIAL NOT NULL,
    "july_label" TEXT,
    "normalized_label" TEXT,
    "label_hash" TEXT NOT NULL,

    CONSTRAINT "historical_catalog_summary_label_pkey" PRIMARY KEY ("label_pair_id")
);

-- CreateTable
CREATE TABLE "historical_catalog_summary_bucket" (
    "bucket_id" BIGSERIAL NOT NULL,
    "lot_key" TEXT NOT NULL,
    "raw_lot_key" TEXT,
    "import_request" TEXT NOT NULL,
    "label_pair_id" BIGINT NOT NULL,
    "normalized_label" TEXT,
    "july_label" TEXT,
    "origin_id" TEXT,
    "niche_key" TEXT NOT NULL,
    "raw_niche_key" TEXT,
    "item_status" TEXT NOT NULL,
    "label_agreement" TEXT NOT NULL,
    "n" INTEGER NOT NULL,
    "touched_epoch" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "historical_catalog_summary_bucket_pkey" PRIMARY KEY ("bucket_id")
);

-- CreateTable
CREATE TABLE "historical_catalog_summary_membership" (
    "item_id" TEXT NOT NULL,
    "bucket_id" BIGINT,
    "accounted" BOOLEAN NOT NULL,
    "applied_at" TIMESTAMPTZ(6),

    CONSTRAINT "historical_catalog_summary_membership_pkey" PRIMARY KEY ("item_id")
);

-- CreateTable
CREATE TABLE "historical_catalog_summary_control" (
    "singleton" BOOLEAN NOT NULL DEFAULT true,
    "summary_ready" BOOLEAN NOT NULL DEFAULT false,
    "summary_epoch" BIGINT NOT NULL DEFAULT 0,
    "reconciled_epoch" BIGINT,
    "reconciled_at" TIMESTAMPTZ(6),
    "invalidated_at" TIMESTAMPTZ(6),
    "invalidation" TEXT,
    "failure_count" BIGINT NOT NULL DEFAULT 0,
    "note" TEXT,

    CONSTRAINT "historical_catalog_summary_control_pkey" PRIMARY KEY ("singleton")
);

-- CreateTable
CREATE TABLE "historical_catalog_summary_checkpoint" (
    "chunk_id" BIGSERIAL NOT NULL,
    "range_after" TEXT NOT NULL,
    "range_until" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "started_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(6),
    "items_applied" INTEGER,
    "note" TEXT,

    CONSTRAINT "historical_catalog_summary_checkpoint_pkey" PRIMARY KEY ("chunk_id")
);

-- CreateIndex
CREATE INDEX "historical_catalog_summary_label_hash" ON "historical_catalog_summary_label"("label_hash");

-- CreateIndex
CREATE INDEX "historical_catalog_summary_bucket_lot" ON "historical_catalog_summary_bucket"("lot_key", "raw_lot_key");

-- CreateIndex
CREATE INDEX "historical_catalog_summary_bucket_raw_lot" ON "historical_catalog_summary_bucket"("raw_lot_key");

-- CreateIndex
CREATE INDEX "historical_catalog_summary_bucket_import" ON "historical_catalog_summary_bucket"("import_request");

-- CreateIndex
CREATE INDEX "historical_catalog_summary_bucket_niche" ON "historical_catalog_summary_bucket"("niche_key", "raw_niche_key");

-- CreateIndex
CREATE INDEX "historical_catalog_summary_checkpoint_status" ON "historical_catalog_summary_checkpoint"("status");

-- AddForeignKey
ALTER TABLE "historical_catalog_summary_bucket" ADD CONSTRAINT "historical_catalog_summary_bucket_label_pair_id_fkey" FOREIGN KEY ("label_pair_id") REFERENCES "historical_catalog_summary_label"("label_pair_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- AddForeignKey
ALTER TABLE "historical_catalog_summary_membership" ADD CONSTRAINT "historical_catalog_summary_membership_bucket_id_fkey" FOREIGN KEY ("bucket_id") REFERENCES "historical_catalog_summary_bucket"("bucket_id") ON DELETE RESTRICT ON UPDATE RESTRICT;

-- Nullable grain columns stay distinct from blank text. NULL origin_id matches
-- NULL origin_id. '' does not match NULL.
ALTER TABLE "historical_catalog_summary_bucket"
  ADD CONSTRAINT "historical_catalog_summary_bucket_grain"
  UNIQUE NULLS NOT DISTINCT (
    "lot_key",
    "raw_lot_key",
    "import_request",
    "label_pair_id",
    "origin_id",
    "niche_key",
    "raw_niche_key",
    "item_status",
    "label_agreement"
  );

ALTER TABLE "historical_catalog_summary_bucket"
  ADD CONSTRAINT "historical_catalog_summary_bucket_n_nonnegative"
  CHECK ("n" >= 0);

ALTER TABLE "historical_catalog_summary_membership"
  ADD CONSTRAINT "historical_catalog_summary_membership_accounted"
  CHECK ("accounted" = ("bucket_id" IS NOT NULL));

ALTER TABLE "historical_catalog_summary_control"
  ADD CONSTRAINT "historical_catalog_summary_control_singleton"
  CHECK ("singleton");

ALTER TABLE "historical_catalog_summary_checkpoint"
  ADD CONSTRAINT "historical_catalog_summary_checkpoint_status_check"
  CHECK ("status" IN ('running', 'complete', 'failed'));

INSERT INTO "historical_catalog_summary_control" ("singleton", "summary_ready", "note")
VALUES (
  true,
  false,
  'Empty campaign summary. summary_ready stays false until a separate approved reconciliation authorizes it.'
);

COMMIT;

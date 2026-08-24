-- Additive per-item commerce exclusion columns.
-- Existing rows remain NULL (commercially eligible). No backfill.
--
-- Index assessment:
-- A standalone btree or partial index on "commerceExcludedAt" IS NULL would
-- cover nearly the entire table and would not improve the existing PPL scan,
-- which already filters status + inventoryClass + niche + state + generatedAt
-- using LeadInventoryItem_inventoryClass_status_idx and
-- LeadInventoryItem_nicheKey_normalizedState_status_idx.
-- Exclusion is rare; the new IS NULL predicate is applied after those
-- selective predicates. No new index.

ALTER TABLE "LeadInventoryItem"
  ADD COLUMN IF NOT EXISTS "commerceExcludedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "commerceExcludedReason" TEXT,
  ADD COLUMN IF NOT EXISTS "commerceExcludedBy" TEXT;

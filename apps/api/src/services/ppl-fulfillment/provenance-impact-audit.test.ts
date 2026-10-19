import assert from "node:assert/strict";
import { test } from "node:test";

import type { PrismaClient } from "@prisma/client";

import {
  classifyStoredCampaignLabels,
  formatPercentBlocked,
  buildProvenanceImpactQuery,
  PROVENANCE_IMPACT_STATEMENT_TIMEOUT_MS,
  PRODUCTION_VERIFIED_ACQUISITION_SQL,
} from "./provenance-impact-query.js";
import {
  assembleProvenanceImpactReport,
  exactCount,
  responseContainsSecret,
  unavailableProvenanceImpact,
} from "./provenance-impact-report.js";
import {
  lookupPersistedVerifiedAcquisitionEvidenceId,
  runProvenanceImpactAudit,
} from "./provenance-impact-audit.js";
import { PPL_PROVENANCE_ELIGIBILITY_POLICY_ID } from "./provenance-eligibility.js";

test("campaign label agreement matches the historical auditor branches", () => {
  const cases = [
    [{ sourceCampaignName: null, normalizedCampaignName: null, rawLeadType: null }, "all_missing"],
    [{ sourceCampaignName: "  ", normalizedCampaignName: "", rawLeadType: " " }, "all_missing"],
    [{ sourceCampaignName: " Alpha ", normalizedCampaignName: null, rawLeadType: null }, "july_column_only"],
    [
      { sourceCampaignName: "Alpha", normalizedCampaignName: "Alpha", rawLeadType: " Alpha " },
      "july_column_agrees",
    ],
    [
      { sourceCampaignName: "Alpha", normalizedCampaignName: "Beta", rawLeadType: null },
      "july_column_conflicts",
    ],
    [
      { sourceCampaignName: "Alpha", normalizedCampaignName: "Alpha", rawLeadType: "Later" },
      "july_column_conflicts",
    ],
    [
      { sourceCampaignName: null, normalizedCampaignName: "Later workbook", rawLeadType: null },
      "post_july_label_without_column",
    ],
  ] as const;
  for (const [input, agreement] of cases) {
    assert.equal(classifyStoredCampaignLabels(input).agreement, agreement);
  }
  assert.equal(classifyStoredCampaignLabels({
    sourceCampaignName: " Alpha ",
    normalizedCampaignName: null,
    rawLeadType: null,
  }).julyLabel, "Alpha");
});

test("percent blocked is an exact fraction and empty populations are not zero percent", () => {
  assert.equal(formatPercentBlocked(0, 0), null);
  assert.equal(formatPercentBlocked(0, 8), "0.0000");
  assert.equal(formatPercentBlocked(1, 3), "33.3333");
  assert.equal(formatPercentBlocked(8, 8), "100.0000");
});

test("production aggregate SQL is select-only, nulls verified acquisition, and omits contact fields", () => {
  const query = buildProvenanceImpactQuery();
  const text = query.strings.join(" ");
  assert.match(text, /NULL::text/);
  assert.equal(PRODUCTION_VERIFIED_ACQUISITION_SQL, "NULL::text");
  assert.equal(PROVENANCE_IMPACT_STATEMENT_TIMEOUT_MS, 120_000);
  assert.doesNotMatch(text, /metadataJson|acquisitionCost|exclusivityMode|LIMIT\s+\d+|maxClassified/i);
  assert.equal(lookupPersistedVerifiedAcquisitionEvidenceId(), null);
});

function zeroRow(): Record<string, unknown> {
  const counts = [
    "inventory_item_rows",
    "classified_items",
    "gate_before",
    "gate_blocked",
    "gate_remaining",
    "gate_confirmed",
    "gate_verified",
    "gate_leadcapture",
    "gate_unresolved",
    "all_confirmed",
    "all_verified",
    "all_leadcapture",
    "all_unresolved",
    "reserved_items",
    "reserved_unresolved",
    "reserved_eligible",
    "open_allocation_rows",
    "open_alloc_rows",
    "open_alloc_unresolved",
    "open_alloc_eligible",
    "open_alloc_missing_inventory",
    "at_risk_orders",
    "mixed_orders",
    "csv_event_rows",
    "csv_events",
    "csv_nonempty",
    "csv_distinct",
    "csv_recoverable",
    "csv_conflicting",
    "csv_missing",
    "csv_distinct_recoverable",
    "csv_distinct_conflicting",
    "agree_all_missing",
    "agree_column_only",
    "agree_agrees",
    "agree_conflicts",
    "agree_post_july",
    "inv_linked",
    "inv_nonempty",
    "inv_recoverable",
    "inv_conflicting",
    "inv_missing",
    "blocked_consistent",
    "blocked_missing",
    "blocked_conflicting",
  ];
  const row: Record<string, unknown> = {
    database_name: "sa360_test",
    server_address: "127.0.0.1/32",
    captured_at: new Date("2026-10-19T00:00:00.000Z"),
    by_status_and_class: [],
    by_niche: [],
    by_lot: [],
    by_item_provider: [],
    by_event_provider: [],
    by_event_system: [],
    by_blocked_niche: [],
    by_blocked_lot: [],
    at_risk_order_numbers: [],
    mixed_order_numbers: [],
  };
  for (const name of counts) row[name] = 0n;
  return row;
}

test("a completed empty snapshot is exact zero, and a broken join is not reported as zero", () => {
  const report = assembleProvenanceImpactReport(zeroRow(), 120_000);
  assert.equal(report.complete, true);
  assert.equal(report.productionImpactMeasured, false);
  assert.equal(report.measurement.readOnlySnapshot, "complete");
  assert.equal(report.measurement.operatorVerifiedProduction, false);
  assert.equal(report.measurement.environmentLabelTrusted, false);
  assert.equal(report.measurement.databaseIdentity?.source, "postgresql");
  assert.equal(report.measurement.databaseIdentity?.name, "sa360_test");
  assert.equal(report.blockedInventoryRecovery.blocked, 0);
  assert.equal(report.blockedInventoryRecovery.furtherAuthorizationRequired, 0);
  assert.equal(report.blockedInventoryRecovery.campaignLabelIsRecoveryCandidateOnly, true);
  assert.equal(report.structuralGate.availableBeforeGate, 0);
  assert.equal(report.structuralGate.percentBlocked, null);
  assert.equal(report.rowCeilingApplied, false);
  assert.equal(report.verifiedAcquisitionEvidence.treatedAs, "absent");
  assert.equal(report.buyerSpecificEligibility.applied, false);

  const broken = zeroRow();
  broken.inventory_item_rows = 5n;
  assert.throws(() => assembleProvenanceImpactReport(broken, 120_000), /reconcile:inventory_join/);
  assert.throws(() => exactCount("1.5", "bad"), /count_not_exact/);
});

test("verified acquisition counts and secret-bearing rows fail closed", () => {
  const row = zeroRow();
  row.gate_verified = 1n;
  row.gate_before = 1n;
  row.gate_remaining = 1n;
  row.all_verified = 1n;
  row.classified_items = 1n;
  row.inventory_item_rows = 1n;
  row.by_status_and_class = [{ status: "available", inventoryClass: "aged", count: 1 }];
  assert.throws(() => assembleProvenanceImpactReport(row, 120_000), /verified_acquisition/);

  const prev = process.env.SA360_AUDIT_READONLY_KEY;
  process.env.SA360_AUDIT_READONLY_KEY = "super-secret-audit-key";
  try {
    assert.equal(responseContainsSecret(JSON.stringify({ note: "super-secret-audit-key" })), true);
    assert.equal(responseContainsSecret(JSON.stringify({ note: "aggregate only" })), false);
  } finally {
    if (prev === undefined) delete process.env.SA360_AUDIT_READONLY_KEY;
    else process.env.SA360_AUDIT_READONLY_KEY = prev;
  }
});

test("an environment label does not mark a completed snapshot as production", () => {
  const previousNodeEnv = process.env.NODE_ENV;
  const previousRole = process.env.SA360_DATABASE_ROLE;
  process.env.NODE_ENV = "production";
  process.env.SA360_DATABASE_ROLE = "production";
  try {
    const report = assembleProvenanceImpactReport(zeroRow(), 120_000);
    assert.equal(report.measurement.readOnlySnapshot, "complete");
    assert.equal(report.measurement.operatorVerifiedProduction, false);
    assert.equal(report.measurement.environmentLabelTrusted, false);
    assert.equal(report.productionImpactMeasured, false);
  } finally {
    if (previousNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = previousNodeEnv;
    if (previousRole === undefined) delete process.env.SA360_DATABASE_ROLE;
    else process.env.SA360_DATABASE_ROLE = previousRole;
  }
});

test("database failures and incomplete scans do not become zero totals", async () => {
  const timeoutDb = {
    $transaction: async () => {
      throw Object.assign(new Error("canceling statement due to statement timeout"), { code: "57014" });
    },
  } as unknown as PrismaClient;
  const timedOut = await runProvenanceImpactAudit(timeoutDb);
  assert.equal(timedOut.ok, false);
  if (timedOut.ok) return;
  assert.equal(timedOut.complete, false);
  assert.equal(timedOut.reason, "statement_timeout");
  assert.equal(timedOut.productionImpactMeasured, false);
  assert.equal(timedOut.measurement.readOnlySnapshot, "incomplete");
  assert.equal(timedOut.measurement.databaseIdentity, null);
  assert.equal(timedOut.measurement.operatorVerifiedProduction, false);
  assert.equal("structuralGate" in timedOut, false);
  assert.equal(JSON.stringify(timedOut).includes("availableBeforeGate"), false);

  const emptyDb = {
    $transaction: async (run: (tx: { $executeRawUnsafe: () => Promise<void>; $queryRaw: () => Promise<unknown[]> }) => Promise<unknown>) =>
      run({
        $executeRawUnsafe: async () => undefined,
        $queryRaw: async () => [],
      }),
  } as unknown as PrismaClient;
  const incomplete = await runProvenanceImpactAudit(emptyDb);
  assert.equal(incomplete.ok, false);
  if (incomplete.ok) return;
  assert.equal(incomplete.reason, "incomplete_result");
  assert.deepEqual(unavailableProvenanceImpact("snapshot_failed").policyId, PPL_PROVENANCE_ELIGIBILITY_POLICY_ID);
});

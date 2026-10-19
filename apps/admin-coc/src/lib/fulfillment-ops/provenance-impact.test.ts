import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatPercentBlocked,
  parseProvenanceImpactReport,
  provenanceImpactModelFromAdminFetch,
} from "./provenance-impact.ts";

function sampleReport(): Record<string, unknown> {
  const availableBeforeGate = 8;
  const blockedByGate = 6;
  const remainingAfterGate = 2;
  return {
    ok: true,
    complete: true,
    productionImpactMeasured: false,
    measurement: {
      readOnlySnapshot: "complete",
      databaseIdentity: {
        source: "postgresql",
        name: "sa360_test",
        serverAddress: "127.0.0.1",
        capturedAt: "2026-10-19T16:00:00.000Z",
      },
      operatorVerifiedProduction: false,
      environmentLabelTrusted: false,
    },
    policyId: "ppl-provenance-eligibility-v1",
    countSemantics: "exact",
    rowCeilingApplied: false,
    verifiedAcquisitionEvidence: {
      persistedVerifiedRecord: false,
      authenticatedLookup: false,
      treatedAs: "absent",
    },
    buyerSpecificEligibility: { applied: false },
    inventoryClassification: { eligible_verified_acquisition: 0 },
    structuralGate: {
      availableBeforeGate,
      blockedByGate,
      remainingAfterGate,
      percentBlocked: formatPercentBlocked(blockedByGate, availableBeforeGate),
      byCode: { eligible_verified_acquisition: 0 },
    },
    breakdowns: {
      byNiche: [{ key: "trucker", before: 8, blocked: 6, remaining: 2 }],
      byLot: [{ key: "lot_a", before: 8, blocked: 6, remaining: 2 }],
      byItemProvider: [{ key: "facebook", before: 8, blocked: 6, remaining: 2 }],
      byEventProvider: [{ key: "(blank)", before: 8, blocked: 6, remaining: 2 }],
      byEventSystem: [{ key: "csv_import", before: 8, blocked: 6, remaining: 2 }],
    },
    blockedInventoryRecovery: {
      campaignLabelIsRecoveryCandidateOnly: true,
      blocked: 6,
      consistentOriginalLabel: 1,
      missingCampaignLabel: 4,
      conflictingCampaignEvidence: 1,
      furtherAuthorizationRequired: 6,
      byNiche: [
        {
          key: "trucker",
          blocked: 6,
          consistentOriginalLabel: 1,
          missingCampaignLabel: 4,
          conflictingCampaignEvidence: 1,
          furtherAuthorizationRequired: 6,
        },
      ],
      byLot: [
        {
          key: "lot_a",
          blocked: 6,
          consistentOriginalLabel: 1,
          missingCampaignLabel: 4,
          conflictingCampaignEvidence: 1,
          furtherAuthorizationRequired: 6,
        },
      ],
    },
    historicalCampaignLabels: {
      events: 10,
      eventsWithNonemptySourceCampaignName: 8,
      distinctSourceCampaignNameCount: 8,
      recoverableConsistentEvents: 7,
      conflictingEvents: 1,
      missingEvents: 2,
      distinctRecoverableLabelCount: 7,
      distinctConflictingLabelCount: 1,
      agreement: {
        all_missing: 1,
        july_column_only: 4,
        july_column_agrees: 3,
        july_column_conflicts: 1,
        post_july_label_without_column: 1,
      },
    },
    reservedAndAllocations: {
      reservedItemsUnresolved: 2,
      openAllocationsUnresolved: 3,
      ordersWithUnresolvedReservedAllocations: 2,
      ordersWithMixedEligibleAndUnresolvedReservedAllocations: 1,
      unresolvedReservedOrderNumbers: ["LO-1", "LO-2"],
      mixedReservedOrderNumbers: ["LO-1"],
    },
    furtherEvidenceRequired: {
      unresolvedInStructuralGate: 6,
      unresolvedReservedItems: 2,
      unresolvedOpenAllocations: 3,
      campaignEventsNotSafelyRecoverable: 3,
      verifiedAcquisitionCannotClearRows: true,
    },
    database: {
      name: "sa360_test",
      serverAddress: "127.0.0.1",
      capturedAt: "2026-10-19T16:00:00.000Z",
    },
  };
}

test("completed report reconciles and drops label text", () => {
  const view = parseProvenanceImpactReport(sampleReport());
  assert.ok(view);
  assert.equal(view.structuralGate.availableBeforeGate, 8);
  assert.equal(view.structuralGate.blockedByGate, 6);
  assert.equal(view.structuralGate.remainingAfterGate, 2);
  assert.equal(view.structuralGate.percentBlocked, "75.0000");
  assert.equal(view.productionImpactMeasured, false);
  assert.equal(view.measurement.readOnlySnapshot, "complete");
  assert.equal(view.measurement.operatorVerifiedProduction, false);
  assert.equal(view.blockedInventoryRecovery.consistentOriginalLabel, 1);
  assert.equal(view.blockedInventoryRecovery.furtherAuthorizationRequired, 6);
  assert.equal(view.buyerSpecificEligibilityApplied, false);
  assert.equal("sourceCampaignName" in view.historicalCampaignLabels, false);
});

test("empty structural gate keeps a null percent", () => {
  const report = sampleReport();
  const gate = report.structuralGate as Record<string, unknown>;
  gate.availableBeforeGate = 0;
  gate.blockedByGate = 0;
  gate.remainingAfterGate = 0;
  gate.percentBlocked = null;
  const evidence = report.furtherEvidenceRequired as Record<string, unknown>;
  evidence.unresolvedInStructuralGate = 0;
  for (const key of Object.keys(report.breakdowns as object)) {
    (report.breakdowns as Record<string, unknown>)[key] = [];
  }
  const recovery = report.blockedInventoryRecovery as Record<string, unknown>;
  recovery.blocked = 0;
  recovery.consistentOriginalLabel = 0;
  recovery.missingCampaignLabel = 0;
  recovery.conflictingCampaignEvidence = 0;
  recovery.furtherAuthorizationRequired = 0;
  recovery.byNiche = [];
  recovery.byLot = [];
  const view = parseProvenanceImpactReport(report);
  assert.equal(view?.structuralGate.percentBlocked, null);
  assert.equal(view?.structuralGate.availableBeforeGate, 0);
  assert.equal(view?.blockedInventoryRecovery.blocked, 0);
  assert.equal(view?.blockedInventoryRecovery.furtherAuthorizationRequired, 0);
});

test("parser rejects secrets, contact data, and broken arithmetic", () => {
  const withLabel = sampleReport();
  (withLabel.historicalCampaignLabels as Record<string, unknown>).sourceCampaignName = "JR Laird";
  assert.equal(parseProvenanceImpactReport(withLabel), null);

  const withEmail = sampleReport();
  (withEmail.database as Record<string, unknown>).name = "buyer@example.com";
  assert.equal(parseProvenanceImpactReport(withEmail), null);

  const withClient = sampleReport();
  withClient.clientDisplayName = "Secret Client";
  assert.equal(parseProvenanceImpactReport(withClient), null);

  const broken = sampleReport();
  (broken.structuralGate as Record<string, unknown>).remainingAfterGate = 1;
  assert.equal(parseProvenanceImpactReport(broken), null);

  const measured = sampleReport();
  measured.productionImpactMeasured = true;
  assert.equal(parseProvenanceImpactReport(measured), null);

  const trustedEnv = sampleReport();
  (trustedEnv.measurement as Record<string, unknown>).environmentLabelTrusted = true;
  assert.equal(parseProvenanceImpactReport(trustedEnv), null);

  const serverVerified = sampleReport();
  (serverVerified.measurement as Record<string, unknown>).operatorVerifiedProduction = true;
  assert.equal(parseProvenanceImpactReport(serverVerified), null);

  const mismatched = sampleReport();
  ((mismatched.measurement as { databaseIdentity: { name: string } }).databaseIdentity).name = "other_db";
  assert.equal(parseProvenanceImpactReport(mismatched), null);

  const badRecovery = sampleReport();
  (badRecovery.blockedInventoryRecovery as Record<string, unknown>).consistentOriginalLabel = 2;
  assert.equal(parseProvenanceImpactReport(badRecovery), null);

  const verified = sampleReport();
  (verified.inventoryClassification as Record<string, unknown>).eligible_verified_acquisition = 1;
  assert.equal(parseProvenanceImpactReport(verified), null);

  const mixed = sampleReport();
  (mixed.reservedAndAllocations as Record<string, unknown>).mixedReservedOrderNumbers = ["LO-9"];
  assert.equal(parseProvenanceImpactReport(mixed), null);
});

test("admin fetch maps disabled, failure, and a completed snapshot", () => {
  assert.deepEqual(
    provenanceImpactModelFromAdminFetch({
      ok: false,
      status: 404,
      body: JSON.stringify({ code: "provenance_impact_audit_disabled" }),
    }),
    { state: "disabled" }
  );
  assert.equal(
    provenanceImpactModelFromAdminFetch({ ok: false, status: 503, body: "{}" }).state,
    "unavailable"
  );
  assert.equal(
    provenanceImpactModelFromAdminFetch({ ok: true, data: { ok: false } }).state,
    "unavailable"
  );
  const ready = provenanceImpactModelFromAdminFetch({ ok: true, data: sampleReport() });
  assert.equal(ready.state, "ready");
});

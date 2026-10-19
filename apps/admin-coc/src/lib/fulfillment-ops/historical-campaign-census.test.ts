import assert from "node:assert/strict";
import { test } from "node:test";

import {
  HISTORICAL_ASSOCIATION_CONTRACT_VIEW,
  historicalCensusModelFromAdminFetch,
  historicalOrderModelFromAdminFetch,
  parseHistoricalCensusReport,
  parseHistoricalOrderReport,
} from "./historical-campaign-census.ts";

function group(keyName: string, key: string, inventoryRows = 2) {
  return {
    [keyName]: key,
    inventoryRows,
    distinctOriginalLabels: 1,
    unresolvedOriginRows: inventoryRows,
    stampedOriginRows: 0,
    consistentOriginalLabelRows: inventoryRows,
    missingAttributionRows: 0,
    conflictingAttributionRows: 0,
    reservedRows: 0,
  };
}

function censusBody(): Record<string, unknown> {
  return {
    ok: true,
    complete: true,
    policyId: "historical-campaign-census-v1",
    provenancePolicyId: "ppl-provenance-eligibility-v1",
    recoveryPolicyId: "historical-campaign-recovery-v1",
    ownershipStampApplied: false,
    resaleAuthorizationApplied: false,
    clientNameMatchUsed: false,
    julySourceCampaignNamePreserved: true,
    labelTextOmitted: true,
    buyerSpecificEligibilityApplied: false,
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
    population: {
      inventoryRows: 2,
      unresolvedOriginRows: 2,
      stampedOriginRows: 0,
      consistentOriginalLabelRows: 2,
      missingAttributionRows: 0,
      conflictingAttributionRows: 0,
      rowsWithOriginalLabel: 2,
      rowsMissingOriginalLabel: 0,
      distinctOriginalLabels: 1,
    },
    labelPopulations: {
      oneRow: 0,
      twoToTenRows: 1,
      elevenToOneHundredRows: 0,
      oneHundredOneToOneThousandRows: 0,
      overOneThousandRows: 0,
      largestLabelInventoryRows: 2,
    },
    byNiche: [group("nicheKey", "vet")],
    byLot: [group("lotKey", "lot_vet")],
    byNicheAndLot: [{ ...group("nicheKey", "vet"), lotKey: "lot_vet" }],
    byImportRequest: [group("importRequest", "aged-bulk-vet")],
    byAgreement: [group("agreement", "july_column_agrees")],
    byInventoryStatus: [group("status", "available")],
    openAllocations: { rows: 0, byStatus: [] },
    stampedOriginClients: [],
  };
}

function orderBody(): Record<string, unknown> {
  return {
    ok: true,
    complete: true,
    policyId: "historical-campaign-census-v1",
    provenancePolicyId: "ppl-provenance-eligibility-v1",
    recoveryPolicyId: "historical-campaign-recovery-v1",
    orderNumber: "LO-1053",
    orderStatus: "active",
    buyerClientAccountId: "buyer_1",
    resaleAuthorizationPersisted: false,
    ownershipStampApplied: false,
    contactOmitted: true,
    measurement: censusBody().measurement,
    allocations: {
      rows: 1,
      reservedRows: 1,
      buyerMismatchRows: 0,
      missingInventoryRows: 0,
      originEqualsBuyerRows: 0,
      originOtherClientRows: 0,
      originUnstampedRows: 1,
      byStatus: [{ status: "reserved", allocations: 1 }],
      byProvenance: [{ provenance: "unresolved_origin", allocations: 1 }],
      byLot: [
        {
          lotKey: "lot_vet",
          allocations: 1,
          unresolvedOrigin: 1,
          originEqualsBuyer: 0,
          originOtherClient: 0,
          originUnstamped: 1,
        },
      ],
    },
    reservedRevisedPolicy: {
      wouldBlockUnresolvedOrigin: 1,
      wouldBlockSameOrigin: 0,
      wouldBlockUntilResaleAuthorization: 0,
      outsideHistoricalGate: 0,
      wouldBlockMissingInventory: 0,
    },
    delivery: {
      packages: 0,
      spreadsheetDeliveredPackages: 0,
      notifyByStatus: [],
      instructionsByStatus: [],
    },
    replacementsByStatus: [],
  };
}

test("census parser accepts a reconciled snapshot and rejects label text", () => {
  const report = parseHistoricalCensusReport(censusBody());
  assert.equal(report?.population.inventoryRows, 2);
  assert.equal(report?.labelTextOmitted, true);
  assert.equal(parseHistoricalCensusReport({ ...censusBody(), sourceCampaignName: "Secret Label" }), null);
  assert.equal(parseHistoricalCensusReport({ ...censusBody(), ownershipStampApplied: true }), null);
  const leaked = censusBody();
  leaked.byNiche = [group("nicheKey", "buyer@example.test")];
  assert.equal(parseHistoricalCensusReport(leaked), null);
});

test("failed census fetches do not become zero totals", () => {
  assert.deepEqual(
    historicalCensusModelFromAdminFetch({
      ok: false,
      status: 404,
      body: JSON.stringify({ ok: false, code: "historical_campaign_census_disabled", inventoryRows: 0 }),
    }),
    { state: "disabled" }
  );
  const unavailable = historicalCensusModelFromAdminFetch({
    ok: false,
    status: 503,
    body: JSON.stringify({ ok: false, complete: false, population: { inventoryRows: 0 } }),
  });
  assert.equal(unavailable.state, "unavailable");
  assert.equal("report" in unavailable, false);
});

test("order parser keeps the buyer id and withholds a missing order", () => {
  const report = parseHistoricalOrderReport(orderBody());
  assert.equal(report?.buyerClientAccountId, "buyer_1");
  assert.equal(report?.reservedRevisedPolicy.wouldBlockUnresolvedOrigin, 1);
  const withEmail = orderBody();
  withEmail.buyerClientAccountId = "buyer@example.test";
  assert.equal(parseHistoricalOrderReport(withEmail)?.buyerClientAccountId, "buyer@example.test");
  assert.equal(parseHistoricalOrderReport({ ...orderBody(), csvContent: "secret" }), null);

  const missing = historicalOrderModelFromAdminFetch(
    {
      ok: false,
      status: 404,
      body: JSON.stringify({
        ok: false,
        code: "historical_order_not_found",
        orderNumber: "LO-1053",
        reservedRows: 0,
      }),
    },
    "LO-1053"
  );
  assert.equal(missing.state, "not_found");
  if (missing.state === "not_found") assert.equal(JSON.stringify(missing).includes("reservedRows"), false);
  assert.equal(
    historicalOrderModelFromAdminFetch(
      { ok: false, status: 400, body: JSON.stringify({ code: "historical_order_number_invalid" }) },
      "LO-1053"
    ).state,
    "invalid"
  );
});

test("association contract separates preview, ownership, and resale", () => {
  assert.equal(HISTORICAL_ASSOCIATION_CONTRACT_VIEW.implemented, false);
  assert.equal(HISTORICAL_ASSOCIATION_CONTRACT_VIEW.auditCredentialAccepted, false);
  const paths = HISTORICAL_ASSOCIATION_CONTRACT_VIEW.routes.map((route) => route.path);
  assert.equal(new Set(paths).size, paths.length);
  assert.equal(paths.some((path) => path.endsWith("/ownership-previews")), true);
  assert.equal(paths.some((path) => path.endsWith("/ownership-confirmations")), true);
  assert.equal(paths.some((path) => path.includes("/historical-campaign-resale/confirmations")), true);
  assert.notEqual(
    paths.find((path) => path.endsWith("/ownership-confirmations")),
    paths.find((path) => path.endsWith("/confirmations") && path.includes("resale"))
  );
});

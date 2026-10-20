import assert from "node:assert/strict";
import { test } from "node:test";

import {
  campaignSelectionKey,
  catalogViewFromAdminResult,
  previewViewFromAdminResult,
} from "./historical-ownership-preview.ts";

const campaign = {
  displayLabel: "Vet Label",
  normalizedLabel: "Vet Label",
  lotKey: "lot_vet",
  importRequest: "import_vet",
  nicheKey: "vet",
  inventoryRows: 2,
  availableRows: 2,
  reservedRows: 0,
  conflictingAttributionRows: 0,
  stampedOriginRows: 0,
  distinctOriginCount: 0,
  originConflict: false,
  whitespaceVariantCount: 1,
  lotAliasStatus: "absent",
  importAliasStatus: "absent",
  lotConfirmedOriginClientAccountId: null,
  importConfirmedOriginClientAccountId: null,
  persistedDecision: "not_eligible",
  persistedReason: "no_coverage",
  persistedOriginClientAccountId: null,
  email: "secret@example.test",
  clientDisplayName: "Secret Buyer",
};

test("catalog view drops contact keys and keeps the July label", () => {
  const view = catalogViewFromAdminResult({
    ok: true,
    data: {
      ok: true,
      contractId: "historical-campaign-association-v1",
      registryRowsWritten: false,
      inventoryRowsWritten: false,
      page: 1,
      pageSize: 25,
      totalCampaigns: 1,
      scopeAttribution: { missingLabelRows: 3, conflictingLabelRows: 1 },
      campaigns: [campaign],
    },
  });
  assert.equal(view.status, 200);
  assert.equal(view.body.state, "ready");
  if (view.body.state !== "ready" || !view.body.catalog) return;
  assert.equal(view.body.catalog.campaigns[0]?.displayLabel, "Vet Label");
  assert.equal(view.body.catalog.missingLabelRows, 3);
  const encoded = JSON.stringify(view.body);
  assert.equal(encoded.includes("secret@example.test"), false);
  assert.equal(encoded.includes("Secret Buyer"), false);
  assert.equal(encoded.includes("email"), false);
});

test("preview view keeps unverified decisions and LO-1053 counts", () => {
  const view = previewViewFromAdminResult({
    ok: true,
    data: {
      ok: true,
      contractId: "historical-campaign-association-v1",
      stampApplied: false,
      resaleAuthorizationApplied: false,
      clientNameMatchEstablishesOwnership: false,
      registryRowsWritten: false,
      inventoryRowsWritten: false,
      verificationStatus: "UNVERIFIED",
      scopeMode: "campaigns",
      scopeKey: "lot_vet",
      unlabeledRowsInSelectedScopes: 3,
      protectedReservation: { orderNumber: "LO-1053", reservedAllocationsAffected: 16, modified: false },
      proposals: [
        {
          normalizedLabel: "Reserved Vet",
          originClientAccountId: "client_a",
          lotKey: "lot_vet",
          importRequest: "import_vet",
          inventoryRows: 16,
          availableRows: 0,
          reservedRows: 16,
          missingLabelRows: 2,
          alreadyStampedToSameClient: 0,
          alreadyStampedToOtherClient: 0,
          conflictingLabelRows: 0,
          ambiguous: false,
          conflict: "none",
          scopeConflict: "none",
          duplicateProposal: false,
          verificationStatus: "UNVERIFIED",
          persisted: {
            decision: "not_eligible",
            reason: "no_coverage",
            originClientAccountId: null,
          },
          hypothetical: {
            decision: "eligible",
            reason: "eligible_scopes_agree",
            originClientAccountId: "client_a",
            rejection: null,
            registryWritePerformed: false,
          },
          exclusionImpact: {
            rowsThatWouldExcludeProposedClientAsBuyer: 16,
            rowsAlreadyStampedToProposedClient: 0,
            reservedOrCommittedAllocationsToProposedClient: 16,
            selectionUnchanged: true,
          },
          protectedReservation: { orderNumber: "LO-1053", reservedAllocationsAffected: 16, modified: false },
          phone: "+15555550100",
        },
      ],
    },
  });
  assert.equal(view.body.state, "ready");
  if (view.body.state !== "ready" || !view.body.preview) return;
  assert.equal(view.body.preview.verificationStatus, "UNVERIFIED");
  assert.equal(view.body.preview.lo1053ReservedAllocations, 16);
  assert.equal(view.body.preview.unlabeledRowsInSelectedScopes, 3);
  assert.equal(view.body.preview.proposals[0]?.missingLabelRows, 2);
  assert.equal(view.body.preview.proposals[0]?.hypotheticalReason, "eligible_scopes_agree");
  assert.equal(JSON.stringify(view.body).includes("+15555550100"), false);
  assert.equal(
    campaignSelectionKey({ lotKey: "lot_vet", importRequest: "import_vet", normalizedLabel: "Reserved Vet" }),
    "lot_vet\nimport_vet\nReserved Vet"
  );
});

test("disabled association responses stay label-free", () => {
  const view = catalogViewFromAdminResult({
    ok: false,
    status: 404,
    body: JSON.stringify({
      code: "historical_campaign_association_disabled",
      label: "secret label",
    }),
  });
  assert.equal(view.body.state, "disabled");
  assert.equal(JSON.stringify(view.body).includes("secret label"), false);
});

import test from "node:test";
import assert from "node:assert/strict";
import type { SourceLeadEvent } from "@prisma/client";

import type { LeadDeliveryJoinContext } from "../lead-delivery/lead-delivery-read.service.js";
import { presentOrderLinkedLeadRow } from "./lead-order-fulfilled-leads.present.js";

function sourceLead(id: string, ownerClientAccountId: string): SourceLeadEvent {
  return {
    id,
    sourceProvider: "facebook",
    sourceSystem: "meta_lead_ads",
    sourceType: "lead_form",
    sourceRouteKey: null,
    sourceCampaignId: "camp_src",
    sourceCampaignName: "Aged Vet Pool",
    sourceFunnelName: null,
    sourceLeadId: null,
    sourceLeadUid: `uid_${id}`,
    clientAccountIdResolved: ownerClientAccountId,
    destinationLocationIdResolved: "loc_original_owner",
    routingRuleIdResolved: "rule_original",
    status: "delivered",
    rawPayloadJson: {},
    normalizedPayloadJson: {
      contact: {
        first_name: "Pat",
        last_name: "Lee",
        email: "pat@example.com",
        phone_e164: "+15551234567",
      },
    },
    routingResultJson: null,
    duplicateRiskJson: null,
    deliveryResultJson: { contactIdGhl: "ghl_original" },
    enrichmentMetadataJson: null,
    routingDryRunDecisionId: null,
    errorSummary: null,
    webhookRequestLogId: null,
    receivedAt: new Date("2026-07-01T10:00:00.000Z"),
    normalizedAt: new Date("2026-07-01T10:01:00.000Z"),
    routedAt: null,
    approvedAt: null,
    deliveredAt: new Date("2026-07-01T10:05:00.000Z"),
    approvedBy: null,
    bulkImportId: null,
    bulkImportRowId: null,
    cleanupStatus: null,
    cleanupReason: null,
    cleanupMarkedAt: null,
    createdAt: new Date("2026-07-01T10:00:00.000Z"),
    updatedAt: new Date("2026-07-01T10:05:00.000Z"),
  };
}

test("rewrites source-owner identity to the buyer and keeps contact masked", () => {
  const ctx: LeadDeliveryJoinContext = {
    sourceLead: sourceLead("evt_ppl", "acct_inventory_owner"),
    decision: null,
    plan: null,
    adapterRun: null,
    liveRun: null,
    clientDisplayName: "Original Inventory Owner LLC",
    timeline: null,
  };

  const row = presentOrderLinkedLeadRow(ctx, {
    leadOrderId: "ord_buyer",
    buyerClientAccountId: "acct_buyer",
    buyerDisplayName: "Summit Insurance",
  });

  assert.equal(row.leadOrderId, "ord_buyer");
  assert.equal(row.id, "evt_ppl");
  assert.equal(row.clientAccountId, "acct_buyer");
  assert.equal(row.clientDisplayName, "Summit Insurance");
  assert.equal(row.matchedClient, "Summit Insurance");
  assert.equal(row.subaccountIdGhl, null);
  assert.equal(row.contactIdGhl, null);
  assert.equal(row.phoneE164, undefined);
  assert.equal(row.email, undefined);
  assert.match(row.phoneMasked ?? "", /\*\*\*/);
  assert.equal(row.emailMasked, "p***@example.com");
  assert.equal("adminDetail" in row, false);
  assert.equal("allocationId" in row, false);
  assert.doesNotMatch(JSON.stringify(row), /acct_inventory_owner|Original Inventory Owner|loc_original_owner|rule_original|ghl_original|alloc_/);
});

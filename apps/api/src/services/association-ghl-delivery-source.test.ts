import test from "node:test";
import assert from "node:assert/strict";
import type { ClientGhlDestination } from "@prisma/client";
import {
  associationDestinationToPlanRule,
  CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID,
  isConfirmedSourceAssociationDecision,
  missingDeliveryRuleBlocker,
  persistedCampaignRoutingRuleId,
  routingAuthorityFromSnapshot,
} from "./association-ghl-delivery-source.js";

const NOW = new Date("2026-10-29T13:47:38.779Z");

test("routing authority is read from the decision snapshot", () => {
  assert.equal(
    routingAuthorityFromSnapshot({
      routingAuthority: "confirmed_source_association",
      sourceAssociation: { matchedBy: "parent_url_key" },
    }),
    "confirmed_source_association"
  );
  assert.equal(routingAuthorityFromSnapshot(null), null);
  assert.equal(routingAuthorityFromSnapshot({ routingAuthority: "  " }), null);
});

test("only a matched association without a rule id is an association decision", () => {
  const snapshot = {
    routingAuthority: "confirmed_source_association",
    sourceAssociation: {
      matchedBy: "parent_url_key",
      parentUrlKey: "go.lifeinsuranceforvets.com/learn-alex-gross",
    },
  };
  assert.equal(
    isConfirmedSourceAssociationDecision({
      matched: true,
      matchedRuleId: null,
      attributionSnapshot: snapshot,
    }),
    true
  );
  assert.equal(
    isConfirmedSourceAssociationDecision({
      matched: true,
      matchedRuleId: "rule_1",
      attributionSnapshot: snapshot,
    }),
    false
  );
  assert.equal(
    isConfirmedSourceAssociationDecision({
      matched: true,
      matchedRuleId: null,
      attributionSnapshot: { routingAuthority: "campaign_routing_rule" },
    }),
    false
  );
});

test("association plan rule copies destination delivery flags and is not persisted as a rule id", () => {
  const shadowed = associationDestinationToPlanRule({
    masterClientAccountId: "lal_master_vet",
    clientDisplayName: "Alex Gross",
    destinationSubaccountIdGhl: "yCziKRW26eFg8IXAQZ73",
    destination: {
      clientAccountId: "alex_gross",
      destinationSubaccountIdGhl: "yCziKRW26eFg8IXAQZ73",
      destinationWorkflowIdGhl: "d4c1fa4c-a3e2-4fd8-9091-b3fad0d04edd",
      deliveryEnabled: false,
      deliveryMode: "shadow",
      clientCutoverApproved: false,
      snapshotInstalled: false,
      requiredFieldsInstalled: false,
      createdAt: NOW,
      updatedAt: NOW,
    } as ClientGhlDestination,
  });
  assert.equal(shadowed.deliveryEnabled, false);
  assert.equal(shadowed.deliveryMode, "shadow");
  assert.equal(shadowed.clientCutoverApproved, false);
  assert.equal(persistedCampaignRoutingRuleId(shadowed), null);

  const laterEnabled = associationDestinationToPlanRule({
    masterClientAccountId: "lal_master_vet",
    clientDisplayName: "Alex Gross",
    destinationSubaccountIdGhl: "",
    destination: {
      clientAccountId: "alex_gross",
      destinationSubaccountIdGhl: "loc_later",
      deliveryEnabled: true,
      deliveryMode: "live",
      clientCutoverApproved: true,
      createdAt: NOW,
      updatedAt: NOW,
    } as ClientGhlDestination,
  });
  assert.equal(laterEnabled.deliveryEnabled, true);
  assert.equal(laterEnabled.deliveryMode, "live");
  assert.equal(laterEnabled.clientCutoverApproved, true);
  assert.equal(laterEnabled.destinationSubaccountIdGhl, "loc_later");
  assert.equal(persistedCampaignRoutingRuleId({ id: "rule_real" }), "rule_real");
  assert.equal(missingDeliveryRuleBlocker(true).includes("no GHL destination"), true);
  assert.equal(missingDeliveryRuleBlocker(false), "Matched routing rule not found for this plan.");
  assert.equal(shadowed.id, CONFIRMED_SOURCE_ASSOCIATION_PLAN_RULE_ID);
});

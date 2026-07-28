import { test } from "node:test";
import assert from "node:assert/strict";

import {
  isItemExcludedByProtectedAgents,
  type ProtectedAgentExclusionRecord,
} from "./protected-agent-exclusion.service.js";

function exclusion(
  matchType: ProtectedAgentExclusionRecord["matchType"],
  matchValue: string
): ProtectedAgentExclusionRecord {
  return {
    id: `${matchType}:${matchValue}`,
    matchType,
    matchValue,
    active: true,
    note: null,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

test("protected-agent exclusion prefers supplier/agent ids and fails closed on unresolved owner", () => {
  const exclusions = [exclusion("normalized_agent_name", "alex agent")];

  const bySupplier = isItemExcludedByProtectedAgents(
    {
      inventoryLot: { supplierAccountId: "supplier_protected" },
      sourceLeadEvent: { enrichmentMetadataJson: {}, normalizedPayloadJson: {} },
    },
    [exclusion("supplier_account_id", "supplier_protected")]
  );
  assert.equal(bySupplier, true);

  const unresolvedWithActiveExclusions = isItemExcludedByProtectedAgents(
    {
      inventoryLot: { supplierAccountId: null },
      sourceLeadEvent: { enrichmentMetadataJson: {}, normalizedPayloadJson: {} },
    },
    exclusions
  );
  assert.equal(unresolvedWithActiveExclusions, true);

  const noExclusions = isItemExcludedByProtectedAgents(
    {
      inventoryLot: { supplierAccountId: null },
      sourceLeadEvent: { enrichmentMetadataJson: {}, normalizedPayloadJson: {} },
    },
    []
  );
  assert.equal(noExclusions, false);
});

test("protected-agent name match is normalized exact, not substring", () => {
  const exclusions = [exclusion("normalized_agent_name", "alex agent")];
  const exact = isItemExcludedByProtectedAgents(
    {
      inventoryLot: { supplierAccountId: null },
      sourceLeadEvent: {
        enrichmentMetadataJson: {
          sourceAttributes: { assigned_agent_name: "Alex  Agent" },
        },
        normalizedPayloadJson: {},
      },
    },
    exclusions
  );
  assert.equal(exact, true);

  const substringOnly = isItemExcludedByProtectedAgents(
    {
      inventoryLot: { supplierAccountId: null },
      sourceLeadEvent: {
        enrichmentMetadataJson: {
          sourceAttributes: { assigned_agent_name: "Alex Agent Jr" },
        },
        normalizedPayloadJson: {},
      },
    },
    exclusions
  );
  assert.equal(substringOnly, false);
});

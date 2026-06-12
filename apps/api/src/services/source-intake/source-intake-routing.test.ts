import test from "node:test";
import assert from "node:assert/strict";
import { matchCampaignRoutingRule } from "../routing-matcher.service.js";
import type { CampaignRoutingRule } from "@prisma/client";

test("route match can identify campaign_id LC_VET_FEX_TEST", () => {
  const rule = {
    id: "rule_lc_vet",
    masterClientAccountId: "leadcapture_io",
    clientAccountId: "smart_agent_360_demo",
    destinationSubaccountIdGhl: "VPuMIhN6JpxdoXvvlekZ",
    matchType: "campaign_id",
    campaignId: "LC_VET_FEX_TEST",
    priority: 100,
    active: true,
  } as CampaignRoutingRule;

  const match = matchCampaignRoutingRule([rule], {
    masterClientAccountId: "leadcapture_io",
    campaignId: "LC_VET_FEX_TEST",
    sourcePlatform: "leadcapture_io",
    sourceType: "leadcapture_form",
  });

  assert.equal(match.matched, true);
  assert.equal(match.destinationClientAccountId, "smart_agent_360_demo");
  assert.equal(match.destinationSubaccountIdGhl, "VPuMIhN6JpxdoXvvlekZ");
});

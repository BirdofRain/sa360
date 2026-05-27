import test from "node:test";
import assert from "node:assert/strict";
import type { CampaignRoutingMatchType } from "@prisma/client";

/** Mirrors prisma/seed-routing-rules.ts identity logic for regression tests. */
function trimOrNull(v?: string): string | null {
  const t = v?.trim();
  return t && t.length > 0 ? t : null;
}

function buildRuleLookupWhere(
  masterClientAccountId: string,
  rule: {
    clientAccountId: string;
    matchType: CampaignRoutingMatchType;
    campaignId?: string;
    utmCampaign?: string;
    keywordPattern?: string;
  }
) {
  return {
    masterClientAccountId,
    clientAccountId: rule.clientAccountId.trim(),
    matchType: rule.matchType,
    campaignId: trimOrNull(rule.campaignId),
    adsetId: null,
    adId: null,
    formId: null,
    utmCampaign: trimOrNull(rule.utmCampaign),
    keywordPattern: trimOrNull(rule.keywordPattern),
  };
}

test("campaign_id and utm_campaign rules for same client are distinct identities", () => {
  const master = "master_1";
  const client = "client_a";
  const a = buildRuleLookupWhere(master, {
    clientAccountId: client,
    matchType: "campaign_id",
    campaignId: "camp_1",
  });
  const b = buildRuleLookupWhere(master, {
    clientAccountId: client,
    matchType: "utm_campaign",
    utmCampaign: "funnel-a",
  });
  assert.notDeepEqual(a, b);
});

test("empty optional match fields normalize to null for lookup", () => {
  const w = buildRuleLookupWhere("m", {
    clientAccountId: "c",
    matchType: "utm_campaign",
    utmCampaign: "x",
    campaignId: "  ",
  });
  assert.equal(w.campaignId, null);
  assert.equal(w.utmCampaign, "x");
});

import test from "node:test";
import assert from "node:assert/strict";
import { parseAttributionSnapshot } from "./routing-dry-run-display.ts";

test("parseAttributionSnapshot exposes attribution fields for drawer display", () => {
  const snap = parseAttributionSnapshot({
    sourcePlatform: "meta",
    sourceType: "paid",
    campaignId: "camp_1",
    campaignName: "Spring",
    adsetId: "adset_1",
    adId: "ad_1",
    formId: "form_1",
    utmCampaign: "utm_c",
    utmContent: "utm_content",
    masterDatasetId: "ds_1",
  });
  assert.equal(snap?.campaignId, "camp_1");
  assert.equal(snap?.utmCampaign, "utm_c");
  assert.equal(snap?.masterDatasetId, "ds_1");
});

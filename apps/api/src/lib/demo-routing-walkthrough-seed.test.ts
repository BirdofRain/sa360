import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../../..");

test("demo walkthrough seed file targets sa360_demo with shadow flags", () => {
  const raw = readFileSync(
    join(REPO_ROOT, "prisma/routing-rules.demo-walkthrough.example.json"),
    "utf8"
  );
  const seed = JSON.parse(raw) as {
    masterClientAccountId: string;
    rules: Array<{
      clientAccountId: string;
      matchType: string;
      deliveryEnabled?: boolean;
      shadowDeliveryEnabled?: boolean;
      campaignId?: string;
      utmCampaign?: string;
    }>;
  };
  assert.equal(seed.masterClientAccountId, "lal_master_vet");
  assert.equal(seed.rules.length, 2);
  for (const rule of seed.rules) {
    assert.equal(rule.clientAccountId, "sa360_demo");
    assert.equal(rule.deliveryEnabled, false);
    assert.equal(rule.shadowDeliveryEnabled, true);
  }
  const types = seed.rules.map((r) => r.matchType).sort();
  assert.deepEqual(types, ["campaign_id", "utm_campaign"]);
});

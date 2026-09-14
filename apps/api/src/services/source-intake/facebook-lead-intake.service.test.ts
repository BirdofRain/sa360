import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeFacebookLeadToLifecyclePayload } from "./facebook-lead-normalizer.js";

const here = dirname(fileURLToPath(import.meta.url));
const intakeSource = readFileSync(join(here, "facebook-lead-intake.service.ts"), "utf8");
const persistSource = readFileSync(join(here, "source-intake-routing-persist.ts"), "utf8");

test("Meta intake source never calls campaign inventory tracking", () => {
  assert.doesNotMatch(intakeSource, /trackCampaignInventory/);
  assert.doesNotMatch(intakeSource, /leadInventoryItem\.create/);
  assert.match(
    intakeSource,
    /Direct Meta Lead Ads are client-committed campaign leads/
  );
});

test("Meta intake source does not reach live GHL delivery", () => {
  assert.doesNotMatch(intakeSource, /enqueueGhl|ghl-live-canary|ghl-delivery-adapter-run|source-lead-delivery/);
  assert.doesNotMatch(persistSource, /enqueueGhl|ghl-live-canary|ghl-delivery-adapter-run|source-lead-delivery/);
  assert.match(persistSource, /No GHL delivery is performed here/);
});

test("Meta intake source does not reach Meta CAPI dispatch", () => {
  assert.doesNotMatch(intakeSource, /enqueueMetaDispatch|metaDispatchAttempt|getMetaDispatchQueue/);
  assert.doesNotMatch(persistSource, /enqueueMetaDispatch|metaDispatchAttempt|getMetaDispatchQueue/);
  const payload = normalizeFacebookLeadToLifecyclePayload(
    {
      leadgenId: "lead_safety_001",
      firstName: "Jane",
      lastName: "Doe",
      email: "jane.safety@example.test",
      phone: "+14155550100",
      state: "TX",
      campaignId: "camp_safety",
      formId: "form_safety",
    },
    { masterClientAccountId: "lal_master_vet" }
  );
  assert.equal(payload.event.send_to_meta, false);
});

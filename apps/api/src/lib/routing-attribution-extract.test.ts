import test from "node:test";
import assert from "node:assert/strict";
import type { LifecycleEventSchema } from "../schemas/lifecycle-event.schema.js";
import { extractRoutingAttributionFromPayload } from "./routing-attribution-extract.js";

const masterVetLeadCreated = {
  schema_version: "1",
  client_account_id: "lal_master_vet",
  contact: { lead_uid: "lead_test_1", contact_id_ghl: "ct_test" },
  state: { lifecycle_stage: "LEAD_CREATED" },
  attribution: {
    source_platform: "facebook",
    source_type: "facebook_lead_form",
    campaign_id: "120243339037000760",
    campaign_name: "Breanne Kimberling- Vet FEX- 4/30/26",
    utm_campaign: "Breanne Kimberling- Vet FEX- 4/30/26",
  },
  event: {
    event_uuid: "ev_test",
    event_name_internal: "lead_created",
    event_name_meta: "Lead Created",
  },
} as LifecycleEventSchema;

test("extractRoutingAttributionFromPayload reads snake_case attribution and master client id", () => {
  const input = extractRoutingAttributionFromPayload(masterVetLeadCreated);
  assert.equal(input.masterClientAccountId, "lal_master_vet");
  assert.equal(input.campaignId, "120243339037000760");
  assert.equal(input.sourcePlatform, "facebook");
  assert.equal(input.sourceType, "facebook_lead_form");
  assert.equal(input.nicheKey, undefined);
  assert.equal(input.productType, undefined);
  assert.equal(input.masterDatasetId, undefined);
});

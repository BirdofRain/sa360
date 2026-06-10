import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCustomFieldStampReport,
  formatCustomFieldStampWarning,
  GHL_SA360_CUSTOM_FIELD_IDS_JSON_EXAMPLE,
} from "./ghl-custom-field-stamp.report.js";

test("buildCustomFieldStampReport detects missing field map", () => {
  const report = buildCustomFieldStampReport(
    { sa360_lead_uid: "lead_1", sa360_routing_status: "LIVE" },
    {}
  );
  assert.equal(report.envConfigured, false);
  assert.equal(report.mappingSource, "none");
  assert.deepEqual(report.logicalKeysToStamp, ["sa360_lead_uid", "sa360_routing_status"]);
  assert.ok(report.skippedReason?.includes("No SA360 custom field ID mapping"));
});

test("formatCustomFieldStampWarning lists logical keys when mapping missing", () => {
  const report = buildCustomFieldStampReport({ sa360_lead_uid: "x" }, {});
  const warning = formatCustomFieldStampWarning(report);
  assert.ok(warning.includes("Logical keys to stamp"));
  assert.ok(warning.includes("sa360_lead_uid"));
  assert.ok(warning.includes("GHL_SA360_CUSTOM_FIELD_IDS_JSON"));
});

test("buildCustomFieldStampReport includes assessment core missing keys", () => {
  const report = buildCustomFieldStampReport(
    { sa360_lead_uid: "lead_1" },
    { sa360_lead_uid: "ghl_field_1" },
    {
      source: "destination_config",
      coreRequiredMissing: ["sa360_campaign_id"],
      optionalMissing: ["sa360_niche_key"],
    }
  );
  assert.equal(report.mappingSource, "destination_config");
  assert.deepEqual(report.coreRequiredMissing, ["sa360_campaign_id"]);
  assert.equal(report.skippedReason, null);
});

test("GHL_SA360_CUSTOM_FIELD_IDS_JSON_EXAMPLE documents expected env shape", () => {
  assert.ok(GHL_SA360_CUSTOM_FIELD_IDS_JSON_EXAMPLE.sa360_lead_uid);
  assert.ok(GHL_SA360_CUSTOM_FIELD_IDS_JSON_EXAMPLE.sa360_routing_status);
});

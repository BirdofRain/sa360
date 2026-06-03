import test from "node:test";
import assert from "node:assert/strict";
import {
  detectSa360RequiredCustomFields,
  parsePipelines,
} from "./ghl-config-discovery.service.js";
import { assertNoTokensInGhlConfigPayload } from "./ghl-config-discovery.present.js";
import type { GhlDiscoveredCustomField } from "./ghl-config-discovery.types.js";

test("parsePipelines normalizes pipelines and stages", () => {
  const pipelines = parsePipelines({
    pipelines: [
      {
        id: "pipe_1",
        name: "Sales",
        stages: [{ id: "stage_new", name: "New Lead", position: 0 }],
      },
    ],
  });
  assert.equal(pipelines[0]?.id, "pipe_1");
  assert.equal(pipelines[0]?.stages[0]?.name, "New Lead");
});

test("detectSa360RequiredCustomFields finds present SA360 keys", () => {
  const fields: GhlDiscoveredCustomField[] = [
    {
      id: "f1",
      name: "SA360 Lead UID",
      key: "sa360_lead_uid",
      fieldKey: "contact.sa360_lead_uid",
      dataType: "TEXT",
    },
    {
      id: "f2",
      name: "Client",
      fieldKey: "contact.sa360_client_account_id",
      key: null,
      dataType: "TEXT",
    },
  ];
  const report = detectSa360RequiredCustomFields(fields);
  assert.equal(report.foundRequiredFields.includes("sa360_lead_uid"), true);
  assert.equal(report.requiredFieldsInstalled, false);
  assert.ok(report.missingRequiredFields.length > 0);
});

test("assertNoTokensInGhlConfigPayload rejects token-like strings", () => {
  assert.throws(
    () =>
      assertNoTokensInGhlConfigPayload({
        note: "access_token leaked",
      }),
    /must not contain tokens/
  );
});

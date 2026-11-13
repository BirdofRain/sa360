import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { COMPANY_SHEETS_V3_COLUMNS } from "@sa360/shared";

import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import {
  CAMPAIGN_DOB_AGE_CONFLICT_WARNING,
  projectCampaignDobAge,
} from "../consumer-age/campaign-dob-age.js";
import { companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import {
  columnMapContentKey,
  customRowProjection,
  type ColumnAssignment,
} from "../company-sheets-delivery/company-sheets-custom-row.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "../source-intake/leadcapture-io-normalizer.js";
import {
  EXTERNAL_WEBHOOK_DOES_NOT_PROVE,
  EXTERNAL_WEBHOOK_RETRIEVAL,
  assessPrimaryCrmDelivery,
  classifyExternalWebhookResponse,
  externalWebhookIdempotencyKey,
  externalWebhookRequestHeaders,
  isExternalWebhookDeliveryEnabled,
  signExternalWebhookBody,
} from "./external-webhook-contract.js";
import {
  buildExternalWebhookAttemptRecord,
  canonicalJson,
  projectExternalWebhookPayload,
  selectPublishedColumnMap,
} from "./external-webhook-payload.js";

const RECEIVED_AT = "2026-10-26T16:00:00.000Z";
const MIGRATION = join(
  dirname(fileURLToPath(import.meta.url)),
  "../../../../../prisma/migrations/20261113194500_external_webhook_destination_foundation"
);

function lead(normalizedPayload: unknown) {
  return {
    stableRowId: "row_external_1",
    clientAccountId: "client_external",
    sourceLeadEventId: "evt_external_1",
    receivedAt: RECEIVED_AT,
    sourceLeadId: "provider_1",
    normalizedPayload,
  };
}

function column(input: Partial<ColumnAssignment> & Pick<ColumnAssignment, "sheetHeader" | "columnIndex" | "target">): ColumnAssignment {
  return {
    formula: false,
    transform: "passthrough",
    decision: "mapped",
    explicit: true,
    code: null,
    ...input,
  };
}

test("v3 webhook fields match the sheet row and keep canonical DOB and age", () => {
  const normalizedPayload = {
    contact: { first_name: "Ada", last_name: "Lovelace", email: "ada@example.test", state: "NY" },
    phone: "5550100123",
    lead_details: {
      date_of_birth: "1979-04-12T03:30:00.000Z",
      consumer_age: "55",
    },
    routing: { source_intake: { submitted_at: "not-a-timestamp" } },
  };
  const row = lead(normalizedPayload);
  const sheet = companySheetsCampaignRowValues({ ...row, schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 });
  assert.ok(sheet);
  const projected = projectExternalWebhookPayload({
    destinationKind: "ghl_inbound",
    destinationRevision: 2,
    lead: row,
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  const direct = projectCampaignDobAge({ normalizedPayload, receivedAt: RECEIVED_AT });
  assert.deepEqual(projected.projection.payload.dobAge, direct);
  assert.equal(projected.projection.payload.dobAge.dateOfBirth, "1979-04-12");
  assert.equal(projected.projection.payload.dobAge.conflict, true);
  assert.equal(projected.projection.payload.fields.date_of_birth, "1979-04-12");
  assert.equal(projected.projection.payload.fields.consumer_age, "55");
  assert.equal(projected.projection.payload.warnings.includes(CAMPAIGN_DOB_AGE_CONFLICT_WARNING), true);
  assert.equal(projected.projection.payload.fields.date_of_birth.includes("America/New_York"), false);
  for (let index = 0; index < COMPANY_SHEETS_V3_COLUMNS.length; index += 1) {
    const sourceField = COMPANY_SHEETS_V3_COLUMNS[index].sourceField;
    assert.equal(projected.projection.payload.fields[sourceField], sheet[index]);
  }
  assert.equal(projected.projection.payload.mapping.mode, "v3_canonical");
  assert.equal(projected.projection.payload.mapping.columnMapId, null);
  assert.equal(
    projected.projection.payload.idempotencyKey,
    externalWebhookIdempotencyKey("client_external", "evt_external_1")
  );
  const again = projectExternalWebhookPayload({
    destinationKind: "ghl_inbound",
    destinationRevision: 2,
    lead: row,
  });
  assert.equal(again.ok, true);
  if (!again.ok) return;
  assert.equal(again.projection.canonicalJson, projected.projection.canonicalJson);
  assert.equal(
    projected.projection.payloadSha256,
    createHash("sha256").update(projected.projection.canonicalJson, "utf8").digest("hex")
  );
});

test("a published map snapshot is frozen and a version change changes the bytes", () => {
  const normalizedPayload = normalizeLeadCaptureIoWebhookToLifecyclePayload({
    provider: "leadcapture_io",
    sa360_source_system: "leadcapture_io_nextgen",
    lead_id: "11111111-2222-4333-8444-555555555558",
    submitted_at: "2026-10-26T15:04:00.000Z",
    first_name: "Redacted",
    last_name: "Example",
    email: "redacted.example@example.test",
    phone: "5550100199",
    state: "TX",
    answers: { age: "55", dob: "04/12/1979", primary_reason: "Family protection" },
  });
  const row = lead(normalizedPayload);
  const assignments = [
    column({
      sheetHeader: "DOB",
      columnIndex: 0,
      target: { kind: "v3_column", header: "DOB", sourceField: "date_of_birth" },
      transform: "date_america_new_york",
    }),
    column({
      sheetHeader: "Primary Concern",
      columnIndex: 1,
      target: { kind: "v3_column", header: "Primary Concern", sourceField: "primary_concern" },
    }),
    column({
      sheetHeader: "Age",
      columnIndex: 2,
      target: { kind: "v3_column", header: "Age", sourceField: "consumer_age" },
    }),
  ];
  const funnel = {
    id: "map_funnel",
    mapVersion: 3,
    sourceScope: "funnel:src_1",
    status: "published",
    assignments,
  };
  const shared = {
    id: "map_shared",
    mapVersion: 1,
    sourceScope: "shared",
    status: "published",
    assignments,
  };
  assert.equal(selectPublishedColumnMap({ funnel, shared })?.id, "map_funnel");
  assert.equal(
    selectPublishedColumnMap({ funnel: { ...funnel, status: "draft" }, shared })?.id,
    "map_shared"
  );
  assert.equal(selectPublishedColumnMap({ funnel: { ...funnel, status: "draft" }, shared: null }), null);

  const selected = selectPublishedColumnMap({ funnel, shared });
  assert.ok(selected);
  const projected = projectExternalWebhookPayload({
    destinationKind: "external_https",
    destinationRevision: 4,
    lead: row,
    publishedMap: selected,
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  const custom = customRowProjection(assignments, row);
  assert.ok(custom);
  assert.deepEqual(projected.projection.payload.dobAge, projectCampaignDobAge({
    normalizedPayload,
    receivedAt: RECEIVED_AT,
  }));
  assert.equal(projected.projection.payload.dobAge.dateOfBirth, "1979-04-12");
  assert.equal(projected.projection.payload.dobAge.conflict, true);
  assert.equal(projected.projection.payload.fields.date_of_birth, "04/12/1979");
  assert.equal(projected.projection.payload.fields.date_of_birth, custom.values[0]);
  assert.equal(projected.projection.payload.fields.primary_concern, custom.values[1]);
  assert.equal(projected.projection.payload.fields.consumer_age, "55");
  assert.deepEqual(projected.projection.payload.warnings, custom.warnings);
  assert.equal(projected.projection.payload.mapping.contentKey, columnMapContentKey("map_funnel", 3));
  assert.equal(projected.projection.payload.mapping.contentKey, "column-map:map_funnel:v3");

  const revised = projectExternalWebhookPayload({
    destinationKind: "external_https",
    destinationRevision: 4,
    lead: row,
    publishedMap: { ...funnel, mapVersion: 4 },
  });
  assert.equal(revised.ok, true);
  if (!revised.ok) return;
  assert.notEqual(revised.projection.payloadSha256, projected.projection.payloadSha256);
  assert.equal(revised.projection.payload.mapping.columnMapVersion, 4);

  const conflict = projectExternalWebhookPayload({
    destinationKind: "external_https",
    destinationRevision: 4,
    lead: row,
    publishedMap: {
      ...funnel,
      assignments: [
        assignments[0],
        column({
          sheetHeader: "Birthday",
          columnIndex: 1,
          target: { kind: "v3_column", header: "DOB", sourceField: "date_of_birth" },
          transform: "passthrough",
        }),
      ],
    },
  });
  assert.equal(conflict.ok, false);
  if (!conflict.ok) assert.equal(conflict.code, "published_map_field_conflict");

  const empty = projectExternalWebhookPayload({
    destinationKind: "external_https",
    destinationRevision: 4,
    lead: row,
    publishedMap: {
      ...funnel,
      assignments: [
        {
          sheetHeader: "Notes to self",
          columnIndex: 0,
          formula: false,
          target: null,
          transform: "blank",
          decision: "unmapped",
          explicit: true,
          code: null,
        },
      ],
    },
  });
  assert.equal(empty.ok, false);
  if (!empty.ok) assert.equal(empty.code, "published_map_empty");
});

test("receipt, signature, and primary CRM contracts stay closed", () => {
  const accepted = classifyExternalWebhookResponse({ requestLeftSa360: true, httpStatus: 200, timedOut: false });
  assert.equal(accepted.ok, true);
  if (accepted.ok) {
    assert.equal(accepted.receipt.outcome, "http_accepted");
    assert.deepEqual(accepted.receipt.proves, ["http_2xx"]);
    assert.deepEqual(accepted.receipt.doesNotProve, EXTERNAL_WEBHOOK_DOES_NOT_PROVE);
  }
  const redirect = classifyExternalWebhookResponse({ requestLeftSa360: true, httpStatus: 302, timedOut: false });
  assert.equal(redirect.ok, true);
  if (redirect.ok) assert.equal(redirect.receipt.outcome, "uncertain");
  const timeout = classifyExternalWebhookResponse({ requestLeftSa360: true, httpStatus: null, timedOut: true });
  assert.equal(timeout.ok, true);
  if (timeout.ok) assert.equal(timeout.receipt.outcome, "uncertain");
  const notSent = classifyExternalWebhookResponse({ requestLeftSa360: false, httpStatus: null, timedOut: false });
  assert.equal(notSent.ok, true);
  if (notSent.ok) {
    assert.equal(notSent.receipt.outcome, "retryable");
    assert.equal(notSent.receipt.requestLeftSa360, false);
  }
  const server = classifyExternalWebhookResponse({ requestLeftSa360: true, httpStatus: 500, timedOut: false });
  assert.equal(server.ok, true);
  if (server.ok) assert.equal(server.receipt.outcome, "uncertain");
  const rejected = classifyExternalWebhookResponse({ requestLeftSa360: true, httpStatus: 400, timedOut: false });
  assert.equal(rejected.ok, true);
  if (rejected.ok) assert.equal(rejected.receipt.outcome, "failed");
  assert.equal(
    classifyExternalWebhookResponse({ requestLeftSa360: false, httpStatus: 200, timedOut: false }).ok,
    false
  );

  const armed = {
    deliveryEnabled: true,
    deliveryMode: "live",
    clientCutoverApproved: true,
    internalApprovalStatus: "approved",
    destinationSubaccountIdGhl: "loc_1",
  };
  assert.equal(
    assessPrimaryCrmDelivery({
      ghl: armed,
      externalWebhookEnabled: true,
      companySheetsCampaignDispatchEnabled: true,
    }).ok,
    false
  );
  assert.equal(
    assessPrimaryCrmDelivery({
      ghl: { ...armed, deliveryMode: "shadow" },
      externalWebhookEnabled: true,
      companySheetsCampaignDispatchEnabled: true,
      legacyCustomWebhookEnabled: true,
    }).ok,
    true
  );
  assert.equal(assessPrimaryCrmDelivery({ ghl: null, externalWebhookEnabled: true }).ok, true);
  assert.equal(assessPrimaryCrmDelivery({ ghl: armed, externalWebhookEnabled: false }).ok, true);

  assert.equal(isExternalWebhookDeliveryEnabled({ SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "true" }), true);
  assert.equal(isExternalWebhookDeliveryEnabled({ SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "TRUE" }), false);
  assert.equal(isExternalWebhookDeliveryEnabled({ SA360_EXTERNAL_WEBHOOK_DELIVERY_ENABLED: "1" }), false);
  assert.equal(isExternalWebhookDeliveryEnabled({}), false);
  assert.equal(EXTERNAL_WEBHOOK_RETRIEVAL.implemented, false);
  assert.equal(EXTERNAL_WEBHOOK_RETRIEVAL.publicRoute, false);

  const signature = signExternalWebhookBody("secret", "{\"a\":1}");
  assert.equal(
    signature,
    `sha256=${createHmac("sha256", "secret").update("{\"a\":1}", "utf8").digest("hex")}`
  );
  assert.equal(signExternalWebhookBody("secret", "{\"a\":1}"), signature);
  assert.notEqual(signExternalWebhookBody("secret", "{\"a\":2}"), signature);
  const headers = externalWebhookRequestHeaders({
    contractVersion: "sa360.external_webhook.lead.v1",
    idempotencyKey: "external-webhook:client_external:evt_external_1",
    mappingMode: "v3_canonical",
    mappingContentKey: null,
    destinationKind: "ghl_inbound",
    destinationRevision: 2,
    signature: null,
  });
  assert.equal(headers["X-SA360-Signature"], undefined);
  assert.equal(headers["X-SA360-Idempotency-Key"], "external-webhook:client_external:evt_external_1");
});

test("the migration is additive and names the receipt contract", () => {
  const up = readFileSync(join(MIGRATION, "migration.sql"), "utf8");
  const down = readFileSync(join(MIGRATION, "down.sql"), "utf8");
  assert.equal(up.includes("DELETE FROM"), false);
  assert.equal(up.includes('UPDATE "'), false);
  assert.equal(up.includes('DROP TABLE "Client'), false);
  assert.equal(up.includes("CREATE TYPE \"ClientDeliveryNotificationChannel\""), false);
  assert.equal(up.includes("'sms'"), true);
  assert.match(up, /deliveryEnabled/);
  assert.match(up, /deliveryMode" = 'live'/);
  assert.match(up, /clientCutoverApproved/);
  assert.match(up, /internalApprovalStatus" = 'approved'/);
  assert.equal(/ALTER TABLE "CompanySheetsDestination"/.test(up), false);
  assert.equal(/ALTER TABLE "ClientCustomWebhookDestination"/.test(up), false);
  assert.equal(/ALTER TABLE "DeliverySuccessNotification"/.test(up), false);
  assert.equal(/UPDATE "CompanySheetsDestination"/.test(up), false);
  assert.equal(/UPDATE "ClientCustomWebhookDestination"/.test(up), false);
  assert.equal(/UPDATE "DeliverySuccessNotification"/.test(up), false);
  assert.match(up, new RegExp(JSON.stringify(EXTERNAL_WEBHOOK_DOES_NOT_PROVE).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  assert.match(down, /DROP TABLE IF EXISTS "ExternalWebhookDeliveryAttempt"/);
  assert.match(down, /DROP TABLE IF EXISTS "ClientExternalWebhookDestination"/);
  assert.match(down, /DROP TRIGGER IF EXISTS "ClientGhlDestination_external_webhook_primary_crm"/);
  assert.equal(down.includes('DROP TABLE "ClientGhlDestination"'), false);
  assert.equal(down.includes('DROP TABLE "ClientDeliveryNotificationPreference"'), false);
  assert.equal(down.includes('DROP TABLE "CompanySheetsDestination"'), false);
  const sample = canonicalJson({ b: 1, a: { d: 2, c: 3 } });
  assert.equal(sample, "{\"a\":{\"c\":3,\"d\":2},\"b\":1}");
});

test("a recorded attempt freezes the projected bytes", () => {
  const projected = projectExternalWebhookPayload({
    destinationKind: "ghl_inbound",
    destinationRevision: 1,
    lead: lead({ contact: { first_name: "Ada", last_name: "Lovelace" }, phone: "5550100123" }),
  });
  assert.equal(projected.ok, true);
  if (!projected.ok) return;
  const record = buildExternalWebhookAttemptRecord({
    destinationId: "dest_1",
    endpointHost: "hooks.example.com",
    endpointUrlFingerprint: "0123456789abcdef",
    projection: projected.projection,
  });
  assert.equal(record.ok, true);
  if (!record.ok) return;
  assert.equal(record.record.state, "recorded");
  assert.equal(record.record.outcome, null);
  assert.equal(record.record.requestLeftSa360, false);
  assert.equal(record.record.payloadCanonicalJson, projected.projection.canonicalJson);
  assert.equal(record.record.mappingMode, "v3_canonical");
  assert.equal(record.record.columnMapId, null);
});

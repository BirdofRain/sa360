import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";

import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3 } from "../../lib/company-google-sheets-env.js";
import { planCustomCampaignSheet } from "../client-onboarding-v2/custom-captured-sheet.js";
import { companySheetsCampaignRowValues } from "../company-sheets-delivery/company-sheets-campaign-row.js";
import { customRowProjection } from "../company-sheets-delivery/company-sheets-custom-row.js";
import { normalizeLeadCaptureIoWebhookToLifecyclePayload } from "../source-intake/leadcapture-io-normalizer.js";
import { processLeadCaptureIoWebhookIntake } from "../source-intake/source-lead-intake.service.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);
const BEFORE_BIRTHDAY = "2026-04-11T23:00:00.000Z";
const ON_BIRTHDAY = "2026-04-12T15:00:00.000Z";

describe("campaign DOB age persists the receipt and projects it", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const routeKey = `LC_DOB_AGE_${randomUUID().slice(0, 8)}`;
  const createdEventIds: string[] = [];

  before(async () => {
    const databaseUrl = assertSafeTestDatabaseUrl(integrationUrlRaw);
    process.env.DATABASE_URL = databaseUrl;
    db = new PrismaClient({ datasources: { db: { url: databaseUrl } } });
  });

  after(async () => {
    if (createdEventIds.length > 0) {
      await db.leadInventoryItem.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.ghlAssociationDispatchOutbox.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.companySheetsDispatchIntent.deleteMany({ where: { sourceLeadEventId: { in: createdEventIds } } });
      await db.sourceLeadEvent.deleteMany({ where: { id: { in: createdEventIds } } });
    }
    await db.sourceRouteSchemaSnapshot.deleteMany({
      where: { sourceProvider: "leadcapture_io", sourceRouteKey: routeKey },
    });
    await db?.$disconnect();
  });

  function payload(leadId: string, dob: unknown, submittedAt?: string): Record<string, unknown> {
    return {
      provider: "leadcapture_io",
      sa360_source_system: "leadcapture_io_nextgen",
      sa360_route_key: routeKey,
      lead_id: leadId,
      ...(submittedAt === undefined ? {} : { submitted_at: submittedAt }),
      first_name: "Redacted",
      last_name: "Example",
      email: `redacted.${leadId.slice(0, 8)}@example.test`,
      phone: "5550100199",
      state: "TX",
      answers: { dateOfBirth: dob },
    };
  }

  async function intake(raw: Record<string, unknown>, receivedAt: string) {
    const result = await processLeadCaptureIoWebhookIntake({
      rawPayload: raw,
      routeKeyFromPath: routeKey,
      receivedAt,
    });
    createdEventIds.push(result.sourceEventId);
    const event = await db.sourceLeadEvent.findUnique({ where: { id: result.sourceEventId } });
    assert.ok(event);
    assert.equal(event.receivedAt.toISOString(), receivedAt);
    return event;
  }

  function project(normalizedPayload: unknown, receivedAt: string) {
    const values = companySheetsCampaignRowValues({
      schemaVersion: COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION_V3,
      stableRowId: "row",
      clientAccountId: "alex_gross",
      sourceLeadEventId: "evt_persisted",
      receivedAt,
      sourceLeadId: "redacted",
      normalizedPayload,
    });
    assert.ok(values);
    const cells = Object.fromEntries(COMPANY_SHEETS_V3_HEADER.map((key, index) => [key, values[index] ?? ""]));
    const header = ["Age", "DOB"];
    const assignments = [
      {
        sheetHeader: "Age",
        columnIndex: 0,
        formula: false,
        target: { kind: "v3_column" as const, header: "Age", sourceField: "consumer_age" },
        transform: "passthrough" as const,
        decision: "mapped" as const,
        explicit: true,
        code: null,
      },
      {
        sheetHeader: "DOB",
        columnIndex: 1,
        formula: false,
        target: { kind: "v3_column" as const, header: "DOB", sourceField: "date_of_birth" },
        transform: "date_america_new_york" as const,
        decision: "mapped" as const,
        explicit: true,
        code: null,
      },
    ];
    const custom = customRowProjection(assignments, {
      stableRowId: "row",
      clientAccountId: "alex_gross",
      sourceLeadEventId: "evt_persisted",
      receivedAt,
      sourceLeadId: "redacted",
      normalizedPayload,
    });
    const preview = planCustomCampaignSheet({
      clientAccountId: "alex_gross",
      spreadsheetId: "copy_sheet_alex",
      campaign: {
        worksheetId: 7,
        worksheetTitle: "VET Web Form",
        schemaVersion: "company_sheets_campaign_custom_v1",
        header,
      },
      publishedMap: {
        id: "map_dob",
        mapVersion: 1,
        spreadsheetId: "copy_sheet_alex",
        worksheetId: 7,
        headerSnapshot: header,
        assignments,
      },
      event: {
        id: "evt_persisted",
        sourceLeadId: "redacted",
        receivedAt,
        normalizedPayloadJson: normalizedPayload,
        enrichmentMetadataJson: {},
      },
    });
    assert.equal(preview.applies && preview.ok, true);
    if (!preview.applies || !preview.ok) throw new Error("preview did not project");
    return { cells, custom, preview: preview.plan };
  }

  it("stores DOB and age from the persisted receipt when submitted_at is missing", async () => {
    const leadId = randomUUID();
    const raw = payload(leadId, "04/12/1979");
    const event = await intake(raw, BEFORE_BIRTHDAY);
    const details = (event.normalizedPayloadJson as { lead_details?: Record<string, unknown> }).lead_details;
    const intakeFields = (
      event.normalizedPayloadJson as { routing?: { source_intake?: { submitted_at?: string } } }
    ).routing?.source_intake;
    assert.equal(intakeFields?.submitted_at, undefined);
    assert.equal(details?.date_of_birth, "1979-04-12");
    assert.equal(details?.consumer_age, "46");
    assert.equal(details?.consumer_age_provenance, "derived_from_date_of_birth");
    assert.equal(details?.consumer_age_reference_date, "2026-04-11");

    const again = normalizeLeadCaptureIoWebhookToLifecyclePayload(raw, { receivedAt: event.receivedAt.toISOString() });
    assert.equal((again.lead_details as { consumer_age?: string }).consumer_age, "46");

    const projected = project(event.normalizedPayloadJson, event.receivedAt.toISOString());
    assert.equal(projected.cells.Age, "46");
    assert.equal(projected.cells.DOB, "1979-04-12");
    assert.deepEqual(projected.custom?.values, ["46", "04/12/1979"]);
    assert.equal(projected.preview.dobAge.age, "46");
    assert.equal(projected.preview.dobAge.dateOfBirth, "1979-04-12");
    assert.equal(projected.preview.dobAge.referenceDate, "2026-04-11");
    assert.equal(projected.preview.dobAge.ageUnavailableReason, null);
    assert.equal(projected.preview.dobAge.referenceRule, "submitted_at_utc_date_else_received_at_utc_date");
  });

  it("uses the stored receipt when submitted_at is nonempty and invalid", async () => {
    const leadId = randomUUID();
    const event = await intake(payload(leadId, "04/12/1979", "not-a-timestamp"), ON_BIRTHDAY);
    const body = event.normalizedPayloadJson as {
      lead_details?: Record<string, unknown>;
      routing?: { source_intake?: { submitted_at?: string } };
    };
    assert.equal(body.routing?.source_intake?.submitted_at, "not-a-timestamp");
    assert.equal(body.lead_details?.date_of_birth, "1979-04-12");
    assert.equal(body.lead_details?.consumer_age, "47");
    assert.equal(body.lead_details?.consumer_age_reference_date, "2026-04-12");
    const projected = project(event.normalizedPayloadJson, event.receivedAt.toISOString());
    assert.equal(projected.cells.Age, "47");
    assert.equal(projected.preview.dobAge.age, "47");
    assert.equal(projected.preview.dobAge.referenceDate, "2026-04-12");
  });

  it("keeps a valid datetime DOB on its written date and rejects a malformed suffix", async () => {
    const validId = randomUUID();
    const valid = await intake(payload(validId, "1979-04-12T00:00:00.000Z", "2026-10-26T15:04:00.000Z"), BEFORE_BIRTHDAY);
    const validDetails = (valid.normalizedPayloadJson as { lead_details?: Record<string, unknown> }).lead_details;
    assert.equal(validDetails?.date_of_birth, "1979-04-12");
    assert.equal(validDetails?.consumer_age, "47");
    const validProjected = project(valid.normalizedPayloadJson, valid.receivedAt.toISOString());
    assert.equal(validProjected.cells.DOB, "1979-04-12");
    assert.equal(validProjected.preview.dobAge.dateOfBirthSheet, "04/12/1979");

    const badId = randomUUID();
    const bad = await intake(payload(badId, "1979-04-12Tanything", "2026-10-26T15:04:00.000Z"), BEFORE_BIRTHDAY);
    const badBody = bad.normalizedPayloadJson as {
      lead_details?: Record<string, unknown>;
      routing?: { source_intake?: { sourceAttributes?: Record<string, unknown> } };
    };
    assert.equal(badBody.lead_details?.date_of_birth, undefined);
    assert.equal(badBody.lead_details?.consumer_age, undefined);
    assert.equal(badBody.routing?.source_intake?.sourceAttributes?.date_of_birth, "1979-04-12Tanything");
    const badProjected = project(bad.normalizedPayloadJson, bad.receivedAt.toISOString());
    assert.equal(badProjected.cells.DOB, "");
    assert.equal(badProjected.cells.Age, "");
    assert.equal(badProjected.preview.dobAge.dateOfBirth, "");
  });
});

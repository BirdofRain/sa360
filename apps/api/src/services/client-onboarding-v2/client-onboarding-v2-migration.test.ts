import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { COMPANY_SHEETS_V3_HEADER } from "@sa360/shared";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";

const repoRoot = join(import.meta.dirname, "../../../../..");
const migrationPath = join(
  repoRoot,
  "prisma/migrations/20261026233000_client_onboarding_v2_persistence/migration.sql"
);
const migrationSql = readFileSync(migrationPath, "utf8");
const schema = readFileSync(join(repoRoot, "prisma/schema.prisma"), "utf8");
const v3Header = [...COMPANY_SHEETS_V3_HEADER];
const canaryHeader = ["delivery_row_id", "sample_formula", "sample_plus", "note"];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function executableSql(sql: string): string {
  return sql.replace(/\/\*[\s\S]*?\*\//g, "").replace(/--.*$/gm, "");
}

async function rejects(run: () => Promise<unknown>, pattern: RegExp): Promise<void> {
  try {
    await run();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    assert.match(message, pattern);
    return;
  }
  assert.fail(`expected rejection matching ${pattern}`);
}

function controlBasis() {
  return {
    establishControl: "drive_owner_verified",
    checkedAt: "2026-10-26T22:00:00.000Z",
  };
}

async function createClient(clientAccountId: string) {
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: `Onboarding v2 ${clientAccountId}` },
  });
}

test("onboarding v2 migration is additive and does not touch delivery tables", () => {
  const sql = executableSql(migrationSql);
  assert.equal(sql.includes("DROP TABLE"), false);
  assert.equal(sql.includes("DROP COLUMN"), false);
  assert.equal(sql.includes("TRUNCATE"), false);
  assert.equal(/DELETE\s+FROM/i.test(sql), false);
  for (const table of [
    "CompanySheetsDestination",
    "CompanySheetsTabContract",
    "CompanySheetsDeliveryJob",
    "CompanySheetsWorksheetLock",
    "CompanySheetsDispatchIntent",
    "ClientGhlDestination",
    "ClientAccount",
    "SourceLeadEvent",
    "DeliveryTarget",
  ]) {
    assert.equal(sql.includes(`ALTER TABLE "${table}"`), false, table);
    assert.equal(new RegExp(`UPDATE\\s+"${table}"`, "i").test(sql), false, table);
  }
  assert.match(sql, /CREATE TABLE "ClientOnboardingDestinationProfile"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingVerifiedTestIdentity"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingTestWorksheet"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingTestRun"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingTestAttempt"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingTestAttemptKey"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingV2AuditEvent"/);
  assert.match(sql, /CREATE TABLE "ClientOnboardingActivationIntent"/);
  assert.match(sql, /CREATE TABLE "ClientSheetColumnMap"/);
  assert.match(sql, /ClientSheetColumnMap_one_published_key/);
  assert.match(sql, /WHERE "status" = 'published'/);
  assert.match(sql, /DEFERRABLE INITIALLY DEFERRED/);
  assert.match(sql, /sa360_lead_note_v2/);
  assert.equal(sql.includes("sa360_lead_note_v1"), false);
  assert.match(schema, /model ClientOnboardingTestWorksheet/);
  assert.equal(schema.includes("model ClientOnboardingVerifiedTestIdentity"), true);
  const identity = schema.slice(
    schema.indexOf("model ClientOnboardingVerifiedTestIdentity"),
    schema.indexOf("model ClientOnboardingTestWorksheet")
  );
  assert.equal(/\baddress\b/i.test(identity), false);
  for (const model of [
    "ClientOnboardingDestinationProfile",
    "ClientOnboardingTestWorksheet",
    "ClientOnboardingTestRun",
    "ClientOnboardingActivationIntent",
    "ClientOnboardingV2AuditEvent",
  ]) {
    const block = schema.slice(schema.indexOf(`model ${model}`), schema.indexOf("model ", schema.indexOf(`model ${model}`) + 8));
    assert.equal(/accessToken|refreshToken|oauth|webhookSecret|password/i.test(block), false, model);
  }
});

test("exact v3 header is 35 cells and is not the canary header", async () => {
  const [row] = await prisma.$queryRaw<Array<{ header: string[] }>>`
    SELECT client_onboarding_v2_exact_v3_header() AS header
  `;
  assert.deepEqual(row?.header, v3Header);
  assert.equal(v3Header.length, 35);
  assert.deepEqual(canaryHeader.length, 4);
  assert.equal(JSON.stringify(row?.header) === JSON.stringify(canaryHeader), false);
});

test("destination profile stores mode, notes, and revision without credentials", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientAccountId = `ob2_profile_${suffix}`;
  await createClient(clientAccountId);
  try {
    const columns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ClientOnboardingDestinationProfile'
        AND column_name ~* 'token|secret|oauth|password|credential|webhook|location'
    `;
    assert.deepEqual(columns, []);
    await prisma.clientOnboardingDestinationProfile.create({
      data: {
        clientAccountId,
        ghlMode: "location_api",
        notesEnabled: true,
        notesContractVersion: "sa360_lead_note_v2",
        sheetsSelected: true,
        revision: 1,
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingDestinationProfile.update({
          where: { clientAccountId },
          data: { notesContractVersion: "sa360_lead_note_v1" },
        }),
      /notes_chk/
    );
    await rejects(
      () =>
        prisma.clientOnboardingDestinationProfile.update({
          where: { clientAccountId },
          data: { ghlMode: "external_zapier", notesEnabled: true },
        }),
      /notes_chk/
    );
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});

test("verified test identities are client-scoped and have no address", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientA = `ob2_id_a_${suffix}`;
  const clientB = `ob2_id_b_${suffix}`;
  await createClient(clientA);
  await createClient(clientB);
  try {
    const addressColumns = await prisma.$queryRaw<Array<{ column_name: string }>>`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'ClientOnboardingVerifiedTestIdentity'
        AND column_name ~* 'address'
    `;
    assert.deepEqual(addressColumns, []);
    await prisma.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: clientA,
        email: `Owner.${suffix}@example.com`,
        phoneE164: "+15555550123",
        evidenceJson: { method: "operator_confirmed" },
        actorLabel: "operator-label",
        requestId: randomUUID(),
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingVerifiedTestIdentity.create({
          data: {
            clientAccountId: clientA,
            email: `owner.${suffix}@example.com`,
            evidenceJson: {},
            requestId: randomUUID(),
          },
        }),
      /client_email_key|Unique constraint/i
    );
    await prisma.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: clientB,
        email: `owner.${suffix}@example.com`,
        evidenceJson: {},
        requestId: randomUUID(),
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingVerifiedTestIdentity.create({
          data: {
            clientAccountId: clientA,
            evidenceJson: {},
            requestId: randomUUID(),
          },
        }),
      /contact_chk/
    );
    const isolated = await prisma.clientOnboardingVerifiedTestIdentity.count({
      where: { clientAccountId: clientB },
    });
    assert.equal(isolated, 1);
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: [clientA, clientB] } } });
  }
});

test("exact v3 test worksheet is unique per client and per sheet", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientA = `ob2_sheet_a_${suffix}`;
  const clientB = `ob2_sheet_b_${suffix}`;
  const spreadsheetId = `sheet_${suffix}`;
  await createClient(clientA);
  await createClient(clientB);
  try {
    await prisma.clientOnboardingTestWorksheet.create({
      data: {
        clientAccountId: clientA,
        spreadsheetId,
        worksheetId: 7,
        worksheetTitle: "Onboarding Test Leads",
        schemaVersion: "company_sheets_campaign_v3",
        header: v3Header,
        headerSha256: sha256(JSON.stringify(v3Header)),
        destinationRevision: 2,
        controlBasis: controlBasis(),
        approvedAt: new Date("2026-10-26T22:05:00.000Z"),
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingTestWorksheet.create({
          data: {
            clientAccountId: clientA,
            spreadsheetId: `other_${suffix}`,
            worksheetId: 1,
            worksheetTitle: "Second",
            schemaVersion: "company_sheets_campaign_v3",
            header: v3Header,
            headerSha256: sha256("second"),
            destinationRevision: 1,
            controlBasis: controlBasis(),
            approvedAt: new Date(),
          },
        }),
      /clientAccountId/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestWorksheet.create({
          data: {
            clientAccountId: clientB,
            spreadsheetId,
            worksheetId: 7,
            worksheetTitle: "Onboarding Test Leads",
            schemaVersion: "company_sheets_campaign_v3",
            header: v3Header,
            headerSha256: sha256(JSON.stringify(v3Header)),
            destinationRevision: 1,
            controlBasis: controlBasis(),
            approvedAt: new Date(),
          },
        }),
      /sheet_key|Unique constraint/i
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestWorksheet.create({
          data: {
            clientAccountId: clientB,
            spreadsheetId: `canary_${suffix}`,
            worksheetId: 9,
            worksheetTitle: "Canary",
            schemaVersion: "company_sheets_canary_v1",
            header: canaryHeader,
            headerSha256: sha256(JSON.stringify(canaryHeader)),
            destinationRevision: 1,
            controlBasis: controlBasis(),
            approvedAt: new Date(),
          },
        }),
      /exact_v3_chk/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestWorksheet.create({
          data: {
            clientAccountId: clientB,
            spreadsheetId: `stats_${suffix}`,
            worksheetId: 3,
            worksheetTitle: "Daily Stats",
            schemaVersion: "company_sheets_campaign_v3",
            header: v3Header,
            headerSha256: sha256(JSON.stringify(v3Header)),
            destinationRevision: 1,
            controlBasis: controlBasis(),
            approvedAt: new Date(),
          },
        }),
      /exact_v3_chk/
    );
    const owned = await prisma.clientOnboardingTestWorksheet.findUniqueOrThrow({
      where: { clientAccountId: clientA },
    });
    assert.equal(owned.schemaVersion, "company_sheets_campaign_v3");
    assert.equal(Array.isArray(owned.header) && (owned.header as string[]).length, 35);
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: [clientA, clientB] } } });
  }
});

test("published column maps are unique and concurrent publishes conflict", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientAccountId = `ob2_map_${suffix}`;
  await createClient(clientAccountId);
  const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const left = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  const right = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  try {
    const spreadsheetId = `mapsheet_${suffix}`;
    await prisma.clientSheetColumnMap.create({
      data: {
        clientAccountId,
        sourceScope: "shared",
        spreadsheetId,
        worksheetId: 4,
        mapVersion: 1,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: ["Age/ DOB", "Primary Reason"],
        assignments: [],
        revision: 1,
        publishedAt: new Date("2026-10-26T22:10:00.000Z"),
      },
    });
    await rejects(
      () =>
        prisma.clientSheetColumnMap.create({
          data: {
            clientAccountId,
            sourceScope: "shared",
            spreadsheetId,
            worksheetId: 4,
            mapVersion: 2,
            status: "published",
            baseSchemaVersion: "legacy_custom",
            headerSnapshot: ["Age/ DOB", "Primary Reason"],
            assignments: [],
            publishedAt: new Date(),
          },
        }),
      /one_published_key|Unique constraint/i
    );
    await prisma.clientSheetColumnMap.update({
      where: {
        clientAccountId_sourceScope_spreadsheetId_worksheetId_mapVersion: {
          clientAccountId,
          sourceScope: "shared",
          spreadsheetId,
          worksheetId: 4,
          mapVersion: 1,
        },
      },
      data: { status: "retired", retiredAt: new Date("2026-10-26T22:11:00.000Z") },
    });
    await prisma.clientSheetColumnMap.create({
      data: {
        clientAccountId,
        sourceScope: "shared",
        spreadsheetId,
        worksheetId: 4,
        mapVersion: 2,
        status: "published",
        baseSchemaVersion: "legacy_custom",
        headerSnapshot: ["Age", "Primary Reason"],
        assignments: [],
        publishedAt: new Date("2026-10-26T22:12:00.000Z"),
      },
    });
    const published = await prisma.clientSheetColumnMap.count({
      where: { clientAccountId, status: "published" },
    });
    assert.equal(published, 1);

    const raceScope = `funnel:funnel_${suffix}`;
    const results = await Promise.allSettled([
      left.clientSheetColumnMap.create({
        data: {
          clientAccountId,
          sourceScope: raceScope,
          spreadsheetId,
          worksheetId: 8,
          mapVersion: 1,
          status: "published",
          baseSchemaVersion: "legacy_custom",
          headerSnapshot: ["Notes"],
          assignments: [],
          publishedAt: new Date(),
        },
      }),
      right.clientSheetColumnMap.create({
        data: {
          clientAccountId,
          sourceScope: raceScope,
          spreadsheetId,
          worksheetId: 8,
          mapVersion: 2,
          status: "published",
          baseSchemaVersion: "legacy_custom",
          headerSnapshot: ["Notes"],
          assignments: [],
          publishedAt: new Date(),
        },
      }),
    ]);
    assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
    assert.equal(results.filter((result) => result.status === "rejected").length, 1);
  } finally {
    await left.$disconnect();
    await right.$disconnect();
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});

test("sheets and ghl attempts stay independent and uncertain evidence stays immutable", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientAccountId = `ob2_attempt_${suffix}`;
  const otherClientId = `ob2_attempt_other_${suffix}`;
  const runId = `run_${suffix}`;
  const requestId = randomUUID();
  await createClient(clientAccountId);
  await createClient(otherClientId);
  const event = await prisma.sourceLeadEvent.create({
    data: {
      sourceProvider: "leadcapture_io",
      sourceSystem: "leadcapture_io_nextgen",
      sourceType: "webhook",
      rawPayloadJson: { fixture: "onboarding-v2-migration" },
      clientAccountIdResolved: clientAccountId,
    },
  });
  const sheetsKey = `onboarding-test:${runId}:sheets`;
  const contactKey = `onboarding-test:${runId}:ghl-contact`;
  const workflowKey = `onboarding-test:${runId}:ghl-workflow`;
  const noteKey = `onboarding-test:${runId}:ghl-note:1`;
  const startedAt = new Date("2026-10-26T22:20:00.000Z");
  try {
    await prisma.clientOnboardingTestRun.create({
      data: {
        id: runId,
        clientAccountId,
        kind: "captured_event_delivery",
        sourceLeadEventId: event.id,
        destinations: ["google_sheets", "ghl_location_api"],
        isolationMode: "isolated_destination",
        sheetsContract: "exact_v3_test_worksheet",
        requestId,
        status: "executing",
        requestSnapshot: {
          requestId,
          kind: "captured_event_delivery",
          destinations: ["google_sheets", "ghl_location_api"],
          isolationMode: "isolated_destination",
          sheetsContract: "exact_v3_test_worksheet",
        },
        warningCodes: [],
        attempts: {
          create: [
            {
              destination: "google_sheets",
              idempotencyKey: sheetsKey,
              status: "executing",
              ownerClientAccountId: clientAccountId,
              spreadsheetId: `sheet_${suffix}`,
              worksheetId: 7,
              worksheetTitle: "Onboarding Test Leads",
              schemaVersion: "company_sheets_campaign_v3",
              header: v3Header,
              headerSha256: sha256(JSON.stringify(v3Header)),
              control: controlBasis(),
              destinationRevision: 2,
              productionCampaignBind: false,
              keys: { create: [{ idempotencyKey: sheetsKey, callKind: "sheets" }] },
            },
            {
              destination: "ghl_location_api",
              idempotencyKey: contactKey,
              status: "executing",
              ownerClientAccountId: clientAccountId,
              keys: {
                create: [
                  { idempotencyKey: contactKey, callKind: "ghl_contact" },
                  { idempotencyKey: workflowKey, callKind: "ghl_workflow" },
                  { idempotencyKey: noteKey, callKind: "ghl_note" },
                ],
              },
            },
          ],
        },
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingTestRun.create({
          data: {
            clientAccountId,
            kind: "preview",
            destinations: ["google_sheets"],
            requestId,
            status: "previewed",
            requestSnapshot: { requestId, kind: "preview" },
          },
        }),
      /requestId/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestAttempt.create({
          data: {
            testRunId: runId,
            destination: "google_sheets",
            idempotencyKey: `lead:${clientAccountId}:${event.id}`,
            status: "not_executed",
            ownerClientAccountId: clientAccountId,
          },
        }),
      /key_chk|run_destination_key|idempotency/
    );
    const sheets = await prisma.clientOnboardingTestAttempt.update({
      where: { idempotencyKey: sheetsKey },
      data: {
        status: "succeeded",
        externalCallExecuted: true,
        appendStartedAt: startedAt,
        proves: ["row_appended"],
        doesNotProve: ["ghl", "campaign_dispatch", "source_delivery"],
        finishedAt: new Date("2026-10-26T22:20:02.000Z"),
      },
    });
    const ghl = await prisma.clientOnboardingTestAttempt.update({
      where: { idempotencyKey: contactKey },
      data: {
        status: "uncertain",
        externalCallExecuted: true,
        uncertainReason: "timeout",
        proves: [],
        doesNotProve: ["contact_upserted", "note_persisted", "downstream_executed"],
        externalCallEvidenceJson: { outcome: "timeout" },
        finishedAt: new Date("2026-10-26T22:20:03.000Z"),
      },
    });
    assert.equal(sheets.status, "succeeded");
    assert.equal(ghl.status, "uncertain");
    await prisma.clientOnboardingTestRun.update({
      where: { id: runId },
      data: {
        status: "uncertain",
        warningCodes: ["ghl_workflow_may_start_downstream_automation"],
        qaEvidenceJson: {
          status: "discarded_duplicates",
          discardedDuplicateCount: 1,
          fullQaCompletenessAsserted: false,
        },
        previewJson: { keptAnswerCount: 1 },
        sheetRowSha256: sha256("row"),
        noteBodySha256: sha256("note"),
      },
    });
    await rejects(
      () => prisma.clientOnboardingTestRun.update({ where: { id: runId }, data: { status: "succeeded" } }),
      /uncertain onboarding test run is immutable/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestRun.update({
          where: { id: runId },
          data: { resendAuthorized: true },
        }),
      /safety_chk|immutable/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestAttempt.update({
          where: { idempotencyKey: sheetsKey },
          data: { appendStartedAt: null },
        }),
      /appendStartedAt evidence cannot be cleared/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestAttempt.update({
          where: { idempotencyKey: contactKey },
          data: { status: "failed" },
        }),
      /uncertain onboarding test attempt evidence is immutable/
    );
    await prisma.clientOnboardingV2AuditEvent.create({
      data: {
        clientAccountId,
        historicalClientAccountId: clientAccountId,
        requestId: randomUUID(),
        action: "reconcile",
        actorLabel: "operator-label",
        sourceLeadEventId: event.id,
        destinations: ["google_sheets", "ghl_location_api"],
        isolationMode: "isolated_destination",
        idempotencyKeys: [sheetsKey, contactKey, workflowKey, noteKey],
        qaEvidenceJson: {
          status: "not_recoverable",
          fullQaCompletenessAsserted: false,
        },
        metadataJson: {
          observation: "sheet row absent and ghl contact absent",
          inspectedAbsentRow: true,
          resendAuthorized: false,
          appendStartedAtCleared: false,
          locksCleared: false,
        },
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingV2AuditEvent.create({
          data: {
            clientAccountId,
            historicalClientAccountId: clientAccountId,
            requestId: randomUUID(),
            action: "reconcile",
            metadataJson: { resendAuthorized: true },
          },
        }),
      /reconcile_chk/
    );
    const run = await prisma.clientOnboardingTestRun.findUniqueOrThrow({
      where: { id: runId },
      include: { attempts: { orderBy: { destination: "asc" } } },
    });
    assert.equal(run.status, "uncertain");
    assert.equal(run.resendAuthorized, false);
    assert.equal(run.appendStartedAtCleared, false);
    assert.equal(run.locksCleared, false);
    assert.equal(run.providerWebhookCalled, false);
    const sheetsAfter = run.attempts.find((attempt) => attempt.destination === "google_sheets");
    const ghlAfter = run.attempts.find((attempt) => attempt.destination === "ghl_location_api");
    assert.equal(sheetsAfter?.status, "succeeded");
    assert.equal(sheetsAfter?.appendStartedAt?.toISOString(), startedAt.toISOString());
    assert.equal(ghlAfter?.status, "uncertain");
    assert.equal(ghlAfter?.appendStartedAt, null);
    const qa = run.qaEvidenceJson as { status: string; fullQaCompletenessAsserted: boolean };
    assert.equal(qa.status, "discarded_duplicates");
    assert.equal(qa.fullQaCompletenessAsserted, false);

    await prisma.clientOnboardingTestRun.update({
      where: { id: runId },
      data: { clientAccountId: otherClientId },
    });
    const moved = await prisma.clientOnboardingTestAttempt.findUniqueOrThrow({
      where: { idempotencyKey: sheetsKey },
    });
    assert.equal(moved.ownerClientAccountId, otherClientId);
    assert.equal(moved.status, "succeeded");
    assert.equal(moved.appendStartedAt?.toISOString(), startedAt.toISOString());

    await rejects(
      () => prisma.sourceLeadEvent.delete({ where: { id: event.id } }),
      /SourceLeadEvent|foreign key/i
    );
  } finally {
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientId] } },
    });
    await prisma.sourceLeadEvent.deleteMany({ where: { id: event.id } });
  }
});

test("historical audit identity survives rekey attribution and client deletion", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientAccountId = `ob2_audit_${suffix}`;
  const requestId = randomUUID();
  await createClient(clientAccountId);
  const audit = await prisma.clientOnboardingV2AuditEvent.create({
    data: {
      clientAccountId,
      historicalClientAccountId: clientAccountId,
      requestId,
      action: "test_execute",
      actorLabel: "operator-label",
      auth: "admin_api_key",
      destinations: ["google_sheets"],
      idempotencyKeys: [],
      qaEvidenceJson: { status: "complete", fullQaCompletenessAsserted: true, discardedDuplicateCount: 0 },
      noteBodySha256: sha256("note"),
      metadataJson: { operation: "execute" },
    },
  });
  try {
    await rejects(
      () =>
        prisma.clientOnboardingV2AuditEvent.update({
          where: { id: audit.id },
          data: { historicalClientAccountId: `rewritten_${suffix}` },
        }),
      /evidence is immutable/
    );
    await rejects(
      () => prisma.clientOnboardingV2AuditEvent.delete({ where: { id: audit.id } }),
      /append-only/
    );
    await rejects(
      () =>
        prisma.clientOnboardingV2AuditEvent.create({
          data: {
            clientAccountId,
            historicalClientAccountId: clientAccountId,
            requestId: randomUUID(),
            action: "test_execute",
            qaEvidenceJson: {
              status: "complete",
              fullQaCompletenessAsserted: false,
            },
          },
        }),
      /qa_evidence_ok|qa_chk|shape_chk/
    );
    await rejects(
      () =>
        prisma.clientOnboardingV2AuditEvent.create({
          data: {
            clientAccountId,
            historicalClientAccountId: clientAccountId,
            requestId: randomUUID(),
            action: "test_execute",
            metadataJson: { answers: ["Spouse"] },
          },
        }),
      /shape_chk|disallowed/
    );
    const rekeyedId = `ob2_audit_rekey_${suffix}`;
    await prisma.clientOnboardingV2AuditEvent.update({
      where: { id: audit.id },
      data: { clientAccountId: rekeyedId },
    });
    await prisma.clientAccount.delete({ where: { clientAccountId } });
    const retained = await prisma.clientOnboardingV2AuditEvent.findUniqueOrThrow({
      where: { id: audit.id },
    });
    assert.equal(retained.historicalClientAccountId, clientAccountId);
    assert.equal(retained.clientAccountId, rekeyedId);
    assert.equal(retained.action, "test_execute");
    assert.equal(retained.auth, "admin_api_key");
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});

test("activation intent and test worksheet do not change delivery or another client", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientA = `ob2_gate_a_${suffix}`;
  const clientB = `ob2_gate_b_${suffix}`;
  const cutoff = new Date("2026-01-15T15:04:05.000Z");
  await createClient(clientA);
  await createClient(clientB);
  const connection = await prisma.companyGoogleConnection.create({
    data: {
      connectionKey: `ob2_${suffix}`,
      status: "disconnected",
    },
  });
  const destinationA = await prisma.companySheetsDestination.create({
    data: {
      clientAccountId: clientA,
      companyConnectionId: connection.id,
      spreadsheetId: `dest_a_${suffix}`,
      spreadsheetUrl: "https://example.test/sheet-a",
      worksheetId: 1,
      worksheetTitle: "Campaign Leads",
      controlBasis: "drive_owner_verified",
      sharingStatus: "missing_recipient",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      agedDispatchEnabled: false,
    },
  });
  const destinationB = await prisma.companySheetsDestination.create({
    data: {
      clientAccountId: clientB,
      companyConnectionId: connection.id,
      spreadsheetId: `dest_b_${suffix}`,
      spreadsheetUrl: "https://example.test/sheet-b",
      worksheetId: 1,
      worksheetTitle: "Campaign Leads",
      controlBasis: "drive_owner_verified",
      sharingStatus: "missing_recipient",
      canaryApproved: false,
      campaignDispatchEnabled: false,
      campaignDispatchNotBefore: cutoff,
      agedDispatchEnabled: false,
    },
  });
  const canary = await prisma.companySheetsTabContract.create({
    data: {
      destinationId: destinationA.id,
      role: "canary",
      setupState: "bound",
      worksheetId: 9,
      worksheetTitle: "Canary",
      schemaVersion: "company_sheets_canary_v1",
      headerContract: canaryHeader,
    },
  });
  await prisma.clientGhlDestination.create({
    data: {
      clientAccountId: clientA,
      destinationSubaccountIdGhl: `loc_${suffix}`,
      workflowTriggerMode: "tag_trigger",
      deliveryEnabled: false,
    },
  });
  try {
    const beforeCanary = await prisma.companySheetsTabContract.findUniqueOrThrow({ where: { id: canary.id } });
    const beforeA = await prisma.companySheetsDestination.findUniqueOrThrow({ where: { id: destinationA.id } });
    const beforeB = await prisma.companySheetsDestination.findUniqueOrThrow({ where: { id: destinationB.id } });
    const beforeGhl = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId: clientA } });
    await prisma.clientOnboardingTestWorksheet.create({
      data: {
        clientAccountId: clientA,
        spreadsheetId: `testsheet_${suffix}`,
        worksheetId: 11,
        worksheetTitle: "Onboarding Test Leads",
        schemaVersion: "company_sheets_campaign_v3",
        header: v3Header,
        headerSha256: sha256(JSON.stringify(v3Header)),
        destinationRevision: 1,
        controlBasis: controlBasis(),
        approvedAt: new Date("2026-10-26T22:30:00.000Z"),
      },
    });
    await prisma.clientOnboardingActivationIntent.create({
      data: {
        clientAccountId: clientA,
        destination: "google_sheets_campaign",
        status: "ready_for_operator",
        revision: 1,
        requestId: randomUUID(),
        expectedReceiptIds: ["receipt_probe", "receipt_synthetic"],
        readinessEvidenceJson: { sheets_no_uncertain_job: true },
        confirmationPhrase: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        actorLabel: "operator-label",
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingActivationIntent.create({
          data: {
            clientAccountId: clientA,
            destination: "google_sheets_campaign",
            status: "activated",
            requestId: randomUUID(),
            confirmationPhrase: "ACTIVATE CLIENT ONBOARDING DESTINATION",
          },
        }),
      /status_chk/
    );
    await rejects(
      () =>
        prisma.clientOnboardingActivationIntent.create({
          data: {
            clientAccountId: clientA,
            destination: "google_sheets_campaign",
            status: "blocked",
            requestId: randomUUID(),
            confirmationPhrase: "ACTIVATE ONE CLIENT DESTINATION",
          },
        }),
      /phrase_chk/
    );
    const afterCanary = await prisma.companySheetsTabContract.findUniqueOrThrow({ where: { id: canary.id } });
    const afterA = await prisma.companySheetsDestination.findUniqueOrThrow({ where: { id: destinationA.id } });
    const afterB = await prisma.companySheetsDestination.findUniqueOrThrow({ where: { id: destinationB.id } });
    const afterGhl = await prisma.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId: clientA } });
    assert.deepEqual(afterCanary, beforeCanary);
    assert.deepEqual(afterA, beforeA);
    assert.deepEqual(afterB, beforeB);
    assert.equal(afterB.campaignDispatchNotBefore?.toISOString(), cutoff.toISOString());
    assert.equal(afterA.campaignDispatchEnabled, false);
    assert.equal(afterA.canaryApproved, false);
    assert.equal(afterB.agedDispatchEnabled, false);
    assert.equal(afterGhl.deliveryEnabled, false);
    assert.equal(afterGhl.workflowTriggerMode, beforeGhl.workflowTriggerMode);
    const [jobs] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "CompanySheetsDeliveryJob"
      WHERE "spreadsheetId" IN (${`dest_a_${suffix}`}, ${`dest_b_${suffix}`}, ${`testsheet_${suffix}`})
    `;
    const [locks] = await prisma.$queryRaw<Array<{ count: number }>>`
      SELECT COUNT(*)::int AS count
      FROM "CompanySheetsWorksheetLock"
      WHERE "spreadsheetId" IN (${`dest_a_${suffix}`}, ${`dest_b_${suffix}`}, ${`testsheet_${suffix}`})
    `;
    assert.equal(jobs?.count, 0);
    assert.equal(locks?.count, 0);
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: [clientA, clientB] } } });
    await prisma.companyGoogleConnection.deleteMany({ where: { id: connection.id } });
  }
});

test("repeat links block deleting the prior run and client deletion cascades the runs", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientAccountId = `ob2_repeat_${suffix}`;
  await createClient(clientAccountId);
  const firstId = `run_first_${suffix}`;
  const secondId = `run_second_${suffix}`;
  try {
    await prisma.clientOnboardingTestRun.create({
      data: {
        id: firstId,
        clientAccountId,
        kind: "preview",
        destinations: ["google_sheets"],
        sheetsContract: "canary_v1_projection",
        requestId: randomUUID(),
        status: "previewed",
        requestSnapshot: { requestId: firstId, kind: "preview" },
      },
    });
    await prisma.clientOnboardingTestRun.create({
      data: {
        id: secondId,
        clientAccountId,
        kind: "preview",
        destinations: ["google_sheets"],
        sheetsContract: "canary_v1_projection",
        repeatOfTestRunId: firstId,
        requestId: randomUUID(),
        status: "previewed",
        requestSnapshot: { requestId: secondId, kind: "preview", repeatOfTestRunId: firstId },
      },
    });
    await rejects(
      () => prisma.clientOnboardingTestRun.delete({ where: { id: firstId } }),
      /repeatOfTestRunId|foreign key/i
    );
    await prisma.clientAccount.delete({ where: { clientAccountId } });
    assert.equal(await prisma.clientOnboardingTestRun.count({ where: { id: { in: [firstId, secondId] } } }), 0);
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});

test("an attempt without its idempotency key row is rejected", async () => {
  const suffix = randomUUID().slice(0, 8);
  const clientAccountId = `ob2_key_${suffix}`;
  const runId = `run_key_${suffix}`;
  await createClient(clientAccountId);
  try {
    await prisma.clientOnboardingTestRun.create({
      data: {
        id: runId,
        clientAccountId,
        kind: "preview",
        destinations: ["ghl_location_api"],
        isolationMode: "verified_test_identity",
        requestId: randomUUID(),
        status: "previewed",
        requestSnapshot: { requestId: runId, kind: "preview" },
      },
    });
    await rejects(
      () =>
        prisma.clientOnboardingTestAttempt.create({
          data: {
            testRunId: runId,
            destination: "ghl_location_api",
            idempotencyKey: `onboarding-test:${runId}:ghl-contact`,
            status: "not_executed",
            ownerClientAccountId: clientAccountId,
          },
        }),
      /attempt idempotency key must be recorded/
    );
    await rejects(
      () =>
        prisma.clientOnboardingTestAttempt.create({
          data: {
            testRunId: runId,
            destination: "ghl_location_api",
            idempotencyKey: `onboarding-test:${runId}:ghl-contact`,
            status: "not_executed",
            ownerClientAccountId: `someone_else_${suffix}`,
            downstreamExecuted: false,
            keys: {
              create: [{ idempotencyKey: `onboarding-test:${runId}:ghl-contact`, callKind: "ghl_contact" }],
            },
          },
        }),
      /owner must equal the run client/
    );
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});

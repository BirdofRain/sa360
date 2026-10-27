import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";

import { COMPANY_SHEETS_V3_HEADER, buildClientRekeyConfirmationPhrase } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { ClientRekeyConflictError, executeClientIdentityRekey } from "./client-rekey.service.js";

const v3Header = [...COMPANY_SHEETS_V3_HEADER];

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

test("rekey preserves onboarding v2 records and leaves historical audit identity unchanged", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const suffix = randomUUID().slice(0, 8);
  const sourceId = `ob2_rekey_src_${suffix}`;
  const targetId = `ob2_rekey_dst_${suffix}`;
  const locationId = `ob2_rekey_loc_${suffix}`;
  const runId = `run_${suffix}`;
  const sheetId = `sheet_${suffix}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId: sourceId,
      clientDisplayName: "Onboarding Rekey Source",
      ghlDestination: { create: { destinationSubaccountIdGhl: locationId, ghlConnectionStatus: "connected" } },
    },
  });
  await prisma.ghlLocationConnection.create({
    data: {
      clientAccountId: sourceId,
      locationId,
      accessTokenEncrypted: "isolated-test-access-token",
      refreshTokenEncrypted: "isolated-test-refresh-token",
      tokenExpiresAt: new Date(Date.now() + 60_000),
      connectionStatus: "connected",
    },
  });
  const auditRequestId = randomUUID();
  try {
    await prisma.clientOnboardingDestinationProfile.create({
      data: {
        clientAccountId: sourceId,
        ghlMode: "location_api",
        notesEnabled: true,
        notesContractVersion: "sa360_lead_note_v2",
        sheetsSelected: true,
        revision: 2,
      },
    });
    await prisma.clientOnboardingVerifiedTestIdentity.create({
      data: {
        clientAccountId: sourceId,
        email: `ada-${suffix}@example.com`,
        phoneE164: "+15555550100",
        requestId: randomUUID(),
        evidenceJson: { method: "operator_confirmed" },
      },
    });
    await prisma.clientOnboardingTestWorksheet.create({
      data: {
        clientAccountId: sourceId,
        spreadsheetId: sheetId,
        worksheetId: 7,
        worksheetTitle: "Approved Test Leads",
        schemaVersion: "company_sheets_campaign_v3",
        header: v3Header,
        headerSha256: sha256(JSON.stringify(v3Header)),
        destinationRevision: 2,
        controlBasis: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T22:00:00.000Z" },
        approvedAt: new Date("2026-10-26T22:05:00.000Z"),
      },
    });
    await prisma.clientOnboardingTestRun.create({
      data: {
        id: runId,
        clientAccountId: sourceId,
        kind: "preview",
        destinations: ["google_sheets", "ghl_location_api"],
        isolationMode: "isolated_destination",
        sheetsContract: "exact_v3_test_worksheet",
        requestId: randomUUID(),
        status: "previewed",
        requestSnapshot: { requestId: runId, kind: "preview", fingerprint: "rekey" },
        warningCodes: [],
        attempts: {
          create: [
            {
              destination: "google_sheets",
              idempotencyKey: `onboarding-test:${runId}:sheets`,
              status: "previewed",
              ownerClientAccountId: sourceId,
              spreadsheetId: sheetId,
              worksheetId: 7,
              worksheetTitle: "Approved Test Leads",
              schemaVersion: "company_sheets_campaign_v3",
              header: v3Header,
              headerSha256: sha256(JSON.stringify(v3Header)),
              control: { establishControl: "drive_owner_verified", checkedAt: "2026-10-26T22:00:00.000Z" },
              destinationRevision: 2,
              productionCampaignBind: false,
              externalCallExecuted: false,
              keys: { create: [{ idempotencyKey: `onboarding-test:${runId}:sheets`, callKind: "sheets" }] },
            },
            {
              destination: "ghl_location_api",
              idempotencyKey: `onboarding-test:${runId}:ghl-contact`,
              status: "previewed",
              ownerClientAccountId: sourceId,
              externalCallExecuted: false,
              downstreamExecuted: false,
              keys: {
                create: [
                  { idempotencyKey: `onboarding-test:${runId}:ghl-contact`, callKind: "ghl_contact" },
                  { idempotencyKey: `onboarding-test:${runId}:ghl-workflow`, callKind: "ghl_workflow" },
                  { idempotencyKey: `onboarding-test:${runId}:ghl-note:1`, callKind: "ghl_note" },
                ],
              },
            },
          ],
        },
      },
    });
    await prisma.clientOnboardingActivationIntent.create({
      data: {
        clientAccountId: sourceId,
        destination: "ghl_location_api",
        status: "blocked",
        requestId: randomUUID(),
        confirmationPhrase: "ACTIVATE CLIENT ONBOARDING DESTINATION",
        activatesDelivery: false,
        deliverySwitchChanged: false,
        cutoffChanged: false,
        expectedReceiptIds: [],
        readinessEvidenceJson: { ready: false },
      },
    });
    await prisma.clientSheetColumnMap.create({
      data: {
        clientAccountId: sourceId,
        sourceScope: "shared",
        spreadsheetId: sheetId,
        worksheetId: 7,
        mapVersion: 1,
        status: "draft",
        baseSchemaVersion: "company_sheets_campaign_v3",
        headerSnapshot: ["Date"],
        assignments: [],
      },
    });
    await prisma.clientOnboardingV2AuditEvent.create({
      data: {
        clientAccountId: sourceId,
        historicalClientAccountId: sourceId,
        requestId: auditRequestId,
        action: "destination_profile_save",
        auth: "admin_api_key",
        destinations: [],
        metadataJson: { revision: 2 },
      },
    });

    const result = await executeClientIdentityRekey({
      sourceClientAccountId: sourceId,
      targetClientAccountId: targetId,
      confirmation: buildClientRekeyConfirmationPhrase(sourceId, targetId),
    });
    assert.equal(result.sourceRemoved, true);
    assert.equal(await prisma.clientAccount.findUnique({ where: { clientAccountId: sourceId } }), null);

    const profile = await prisma.clientOnboardingDestinationProfile.findUniqueOrThrow({ where: { clientAccountId: targetId } });
    assert.equal(profile.notesContractVersion, "sa360_lead_note_v2");
    assert.equal(profile.revision, 2);
    const identity = await prisma.clientOnboardingVerifiedTestIdentity.findFirstOrThrow({ where: { clientAccountId: targetId } });
    assert.equal(identity.phoneE164, "+15555550100");
    const worksheet = await prisma.clientOnboardingTestWorksheet.findUniqueOrThrow({ where: { clientAccountId: targetId } });
    assert.equal(worksheet.spreadsheetId, sheetId);
    const run = await prisma.clientOnboardingTestRun.findUniqueOrThrow({ where: { id: runId } });
    assert.equal(run.clientAccountId, targetId);
    const attempts = await prisma.clientOnboardingTestAttempt.findMany({ where: { testRunId: runId } });
    assert.equal(attempts.length, 2);
    assert.ok(attempts.every((attempt) => attempt.ownerClientAccountId === targetId));
    assert.equal(attempts.every((attempt) => attempt.externalCallExecuted === false), true);
    const intent = await prisma.clientOnboardingActivationIntent.findFirstOrThrow({ where: { clientAccountId: targetId } });
    assert.equal(intent.activatesDelivery, false);
    const map = await prisma.clientSheetColumnMap.findFirstOrThrow({ where: { clientAccountId: targetId } });
    assert.equal(map.status, "draft");
    const audit = await prisma.clientOnboardingV2AuditEvent.findUniqueOrThrow({ where: { requestId: auditRequestId } });
    assert.equal(audit.clientAccountId, targetId);
    assert.equal(audit.historicalClientAccountId, sourceId);
    assert.equal(await prisma.clientOnboardingDestinationProfile.count({ where: { clientAccountId: sourceId } }), 0);
    assert.equal(await prisma.clientOnboardingTestRun.count({ where: { clientAccountId: sourceId } }), 0);
  } finally {
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId } });
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: [sourceId, targetId] } } });
  }
});

test("rekey refuses a target client that already exists and leaves source records in place", async () => {
  assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const suffix = randomUUID().slice(0, 8);
  const sourceId = `ob2_rekey_keep_${suffix}`;
  const targetId = `ob2_rekey_busy_${suffix}`;
  const sourceLocation = `ob2_keep_loc_${suffix}`;
  const targetLocation = `ob2_busy_loc_${suffix}`;
  for (const [clientAccountId, locationId] of [
    [sourceId, sourceLocation],
    [targetId, targetLocation],
  ] as const) {
    await prisma.clientAccount.create({
      data: {
        clientAccountId,
        clientDisplayName: clientAccountId,
        ghlDestination: { create: { destinationSubaccountIdGhl: locationId, ghlConnectionStatus: "connected" } },
      },
    });
    await prisma.ghlLocationConnection.create({
      data: {
        clientAccountId,
        locationId,
        accessTokenEncrypted: "isolated-test-access-token",
        refreshTokenEncrypted: "isolated-test-refresh-token",
        tokenExpiresAt: new Date(Date.now() + 60_000),
        connectionStatus: "connected",
      },
    });
  }
  await prisma.clientOnboardingDestinationProfile.create({
    data: { clientAccountId: sourceId, ghlMode: "unset", sheetsSelected: false },
  });
  try {
    await assert.rejects(
      () =>
        executeClientIdentityRekey({
          sourceClientAccountId: sourceId,
          targetClientAccountId: targetId,
          confirmation: buildClientRekeyConfirmationPhrase(sourceId, targetId),
        }),
      (error: unknown) => error instanceof ClientRekeyConflictError
    );
    const profile = await prisma.clientOnboardingDestinationProfile.findUniqueOrThrow({ where: { clientAccountId: sourceId } });
    assert.equal(profile.ghlMode, "unset");
    assert.equal(await prisma.clientOnboardingDestinationProfile.findUnique({ where: { clientAccountId: targetId } }), null);
  } finally {
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId: { in: [sourceLocation, targetLocation] } } });
    await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: [sourceId, targetId] } } });
  }
});

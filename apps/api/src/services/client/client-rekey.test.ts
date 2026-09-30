import assert from "node:assert/strict";
import test from "node:test";
import { PrismaClient } from "@prisma/client";
import { buildClientRekeyConfirmationPhrase } from "@sa360/shared";
import { prisma } from "../../lib/db.js";
import { assertSafeTestDatabaseUrl } from "../../lib/safe-test-database-url.js";
import { saveClientOnboardingSetup } from "../client-onboarding-setup.service.js";
import {
  ClientRekeyConflictError,
  executeClientIdentityRekey,
} from "./client-rekey.service.js";

async function waitForClientRowLockWaiters(
  db: PrismaClient,
  minimum: number
): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const [row] = await db.$queryRaw<Array<{ count: bigint }>>`
      SELECT COUNT(*)::bigint AS "count"
      FROM pg_stat_activity
      WHERE datname = current_database()
        AND pid <> pg_backend_pid()
        AND wait_event_type = 'Lock'
        AND query LIKE '%FROM "ClientAccount"%'
        AND query LIKE '%FOR UPDATE%'
    `;
    if (Number(row?.count ?? 0) >= minimum) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${minimum} ClientAccount row-lock waiter(s).`);
}

test("rekey confirmation phrase format", () => {
  assert.equal(
    buildClientRekeyConfirmationPhrase("smart_agent_360_demo_2", "smart_agent_360_demo"),
    "REKEY CLIENT smart_agent_360_demo_2 TO smart_agent_360_demo"
  );
});

test("target-existing conflict error exposes conflicts", () => {
  const err = new ClientRekeyConflictError([
    "Target client already has destination location other_loc, which differs from source location VPuMIhN6JpxdoXvvlekZ.",
  ]);
  assert.equal(err.code, "client_rekey_conflict");
  assert.equal(err.conflicts.length, 1);
});

test("rekey races safely with a setup save and retains setup/audit attribution", async () => {
  const suffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sourceClientAccountId = `rekey_setup_source_${suffix}`;
  const targetClientAccountId = `rekey_setup_target_${suffix}`;
  const locationId = `rekey_setup_location_${suffix}`;
  const testDatabaseUrl = assertSafeTestDatabaseUrl(process.env.SA360_TEST_DATABASE_URL);
  const concurrentDb = new PrismaClient({
    datasources: { db: { url: testDatabaseUrl } },
  });
  const blockerDb = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  const monitorDb = new PrismaClient({ datasources: { db: { url: testDatabaseUrl } } });
  await prisma.clientAccount.create({
    data: {
      clientAccountId: sourceClientAccountId,
      clientDisplayName: "Rekey Setup Source",
      ghlDestination: {
        create: {
          destinationSubaccountIdGhl: locationId,
          ghlConnectionStatus: "connected",
        },
      },
    },
  });
  await prisma.ghlLocationConnection.create({
    data: {
      clientAccountId: sourceClientAccountId,
      locationId,
      accessTokenEncrypted: "isolated-test-access-token",
      refreshTokenEncrypted: "isolated-test-refresh-token",
      tokenExpiresAt: new Date(Date.now() + 60_000),
      connectionStatus: "connected",
    },
  });
  try {
    for (const [expectedRevision, owner] of ["One", "Two", "Three"].entries()) {
      const saved = await saveClientOnboardingSetup(sourceClientAccountId, {
        requestId: crypto.randomUUID(),
        expectedRevision,
        intent: "save_draft",
        data: { setupOwner: owner },
      });
      assert.equal(saved.ok, true);
    }
    const sourceSetup = await prisma.clientOnboardingSetup.findUniqueOrThrow({
      where: { clientAccountId: sourceClientAccountId },
    });

    let releaseBlocker: () => void = () => undefined;
    let confirmBlocker: () => void = () => undefined;
    const blockerReleased = new Promise<void>((resolve) => {
      releaseBlocker = resolve;
    });
    const blockerAcquired = new Promise<void>((resolve) => {
      confirmBlocker = resolve;
    });
    const blocker = blockerDb.$transaction(
      async (tx) => {
        await tx.$queryRaw`
          SELECT "clientAccountId"
          FROM "ClientAccount"
          WHERE "clientAccountId" = ${sourceClientAccountId}
          FOR UPDATE
        `;
        confirmBlocker();
        await blockerReleased;
      },
      { timeout: 15_000 }
    );
    await blockerAcquired;

    const rekey = executeClientIdentityRekey({
      sourceClientAccountId,
      targetClientAccountId,
      confirmation: buildClientRekeyConfirmationPhrase(
        sourceClientAccountId,
        targetClientAccountId
      ),
    });
    let concurrentSave: ReturnType<typeof saveClientOnboardingSetup> | null = null;
    try {
      await waitForClientRowLockWaiters(monitorDb, 1);
      concurrentSave = saveClientOnboardingSetup(sourceClientAccountId, {
        requestId: crypto.randomUUID(),
        expectedRevision: 3,
        intent: "save_draft",
        data: { setupOwner: "Concurrent save" },
      }, concurrentDb);
      await waitForClientRowLockWaiters(monitorDb, 2);
    } finally {
      releaseBlocker();
      await blocker;
    }
    assert.ok(concurrentSave);
    const [saveResult, result] = await Promise.all([concurrentSave, rekey]);

    assert.equal(saveResult.ok, false);
    if (!saveResult.ok) {
      assert.equal(saveResult.code, "STALE_WRITE");
      assert.match(saveResult.error, /changed identity|reload/i);
    }
    assert.equal(result.sourceRemoved, true);
    assert.equal(result.movedReferences["ClientOnboardingSetup.clientAccountId"], 1);
    assert.equal(
      result.movedReferences["ClientOnboardingSetupAuditEvent.clientAccountId"],
      3
    );

    const movedSetup = await prisma.clientOnboardingSetup.findUniqueOrThrow({
      where: { clientAccountId: targetClientAccountId },
    });
    assert.equal(movedSetup.id, sourceSetup.id);
    assert.deepEqual(movedSetup.setupDataJson, { setupOwner: "Three" });
    const audits = await prisma.clientOnboardingSetupAuditEvent.findMany({
      where: { setupId: movedSetup.id },
    });
    assert.equal(audits.length, 3);
    assert.ok(audits.every((event) => event.setupId === movedSetup.id));
    assert.ok(audits.every((event) => event.clientAccountId === targetClientAccountId));
    assert.ok(
      audits.every(
        (event) => event.historicalClientAccountId === sourceClientAccountId
      )
    );
  } finally {
    await concurrentDb.$disconnect();
    await blockerDb.$disconnect();
    await monitorDb.$disconnect();
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId } });
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [sourceClientAccountId, targetClientAccountId] } },
    });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: sourceClientAccountId },
    });
  }
});

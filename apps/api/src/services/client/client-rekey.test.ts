import assert from "node:assert/strict";
import test from "node:test";
import { buildClientRekeyConfirmationPhrase } from "@sa360/shared";
import { prisma } from "../../lib/db.js";
import { saveClientOnboardingSetup } from "../client-onboarding-setup.service.js";
import {
  ClientRekeyConflictError,
  executeClientIdentityRekey,
} from "./client-rekey.service.js";

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

test("rekey moves the live onboarding setup and current audit attribution", async () => {
  const suffix = `${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const sourceClientAccountId = `rekey_setup_source_${suffix}`;
  const targetClientAccountId = `rekey_setup_target_${suffix}`;
  const locationId = `rekey_setup_location_${suffix}`;
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

    const result = await executeClientIdentityRekey({
      sourceClientAccountId,
      targetClientAccountId,
      confirmation: buildClientRekeyConfirmationPhrase(
        sourceClientAccountId,
        targetClientAccountId
      ),
    });
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
    assert.ok(audits.every((event) => event.clientAccountId === targetClientAccountId));
    assert.ok(
      audits.every(
        (event) => event.historicalClientAccountId === sourceClientAccountId
      )
    );
  } finally {
    await prisma.ghlLocationConnection.deleteMany({ where: { locationId } });
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [sourceClientAccountId, targetClientAccountId] } },
    });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: sourceClientAccountId },
    });
  }
});

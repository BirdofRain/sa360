import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../lib/db.js";
import {
  getClientOnboardingSetup,
  missingClientSetupFields,
  saveClientOnboardingSetup,
} from "./client-onboarding-setup.service.js";
import {
  createClientAdmin,
  deleteClientAdmin,
  getClientDeletionImpact,
} from "./client-account.service.js";

test("draft setup persists, resumes, and idempotent replay has no operational side effects", async () => {
  const clientAccountId = `setup_test_${Date.now()}`;
  const requestId = crypto.randomUUID();
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Setup Test Client",
      primaryNicheKeys: ["VET"],
      primaryProductTypes: ["final_expense"],
    },
  });
  try {
    const first = await saveClientOnboardingSetup(clientAccountId, {
      requestId,
      expectedRevision: 0,
      intent: "save_draft",
      data: {
        sourceProvider: "nextgen",
        trafficSourceName: "LeadCapture NextGen",
        nextgenFunnelName: "Test funnel",
      },
    });
    assert.equal(first.ok, true);
    if (!first.ok) return;
    assert.equal(first.item.status, "draft");
    assert.ok(first.item.missingRequiredFields.includes("testLeadUuid"));

    const replay = await saveClientOnboardingSetup(clientAccountId, {
      requestId,
      expectedRevision: 0,
      intent: "save_draft",
      data: {
        sourceProvider: "nextgen",
        trafficSourceName: "LeadCapture NextGen",
        nextgenFunnelName: "Test funnel",
      },
    });
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.replayed, true);
    assert.equal(replay.item.data.trafficSourceName, "LeadCapture NextGen");

    const resumed = await getClientOnboardingSetup(clientAccountId);
    assert.equal(resumed?.data.nextgenFunnelName, "Test funnel");
    assert.equal(
      await prisma.campaignRoutingRule.count({ where: { clientAccountId } }),
      0
    );
    assert.equal(await prisma.deliveryTarget.count({ where: { clientAccountId } }), 0);
    assert.equal(await prisma.clientGhlDestination.count({ where: { clientAccountId } }), 0);
    assert.equal(
      await prisma.sourceFunnel.count({
        where: {
          OR: [{ suggestedClientAccountId: clientAccountId }, { originClientAccountId: clientAccountId }],
        },
      }),
      0
    );
    assert.equal(
      await prisma.googleAccountConnection.count({ where: { clientAccountId } }),
      0
    );
    const unchangedClient = await prisma.clientAccount.findUniqueOrThrow({
      where: { clientAccountId },
      select: { portalInviteTokenHash: true, portalInviteExpiresAt: true },
    });
    assert.equal(unchangedClient.portalInviteTokenHash, null);
    assert.equal(unchangedClient.portalInviteExpiresAt, null);
    assert.equal(
      await prisma.clientOnboardingSetupAuditEvent.count({ where: { clientAccountId } }),
      1
    );
  } finally {
    await prisma.clientAccount.delete({ where: { clientAccountId } });
  }
});

test("submission fails closed when required source proof is missing", async () => {
  const clientAccountId = `setup_submit_${Date.now()}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Submit Test Client",
      primaryNicheKeys: ["VET"],
      primaryProductTypes: ["final_expense"],
    },
  });
  try {
    const result = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      intent: "submit",
      data: {
        sourceProvider: "nextgen",
        trafficSourceName: "NextGen",
        destinationChoice: "intake_only",
      },
    });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.equal(result.code, "VALIDATION");
    assert.ok(result.missingRequiredFields?.includes("nextgenFunnelUrl"));
    assert.equal(await prisma.clientOnboardingSetup.count({ where: { clientAccountId } }), 0);
  } finally {
    await prisma.clientAccount.delete({ where: { clientAccountId } });
  }
});

test("complete setup can be submitted without activating anything", async () => {
  const clientAccountId = `setup_complete_${Date.now()}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Complete Setup",
      primaryNicheKeys: ["MTG"],
      primaryProductTypes: ["exclusive"],
    },
  });
  try {
    const result = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      intent: "submit",
      data: {
        sourceProvider: "other",
        trafficSourceName: "Partner referral",
        destinationChoice: "intake_only",
      },
    });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.item.status, "submitted");
    assert.ok(result.item.submittedAt);
    assert.equal(result.item.operationalEffects, false);
    assert.equal(await prisma.campaignRoutingRule.count({ where: { clientAccountId } }), 0);
    assert.equal(await prisma.deliveryTarget.count({ where: { clientAccountId } }), 0);
  } finally {
    await prisma.clientAccount.delete({ where: { clientAccountId } });
  }
});

test("duplicate account IDs return a helpful conflict without a second account", async () => {
  const clientAccountId = `duplicate_${Date.now()}`;
  try {
    const first = await createClientAdmin({
      clientAccountId,
      clientDisplayName: "Original",
      primaryNicheKeys: ["VET", " vet "],
      primaryProductTypes: ["aged"],
    });
    assert.equal("error" in first, false);
    const second = await createClientAdmin({
      clientAccountId,
      clientDisplayName: "Retry",
    });
    assert.equal("error" in second, true);
    if ("error" in second) assert.match(second.error, /already in use/i);
    assert.equal(await prisma.clientAccount.count({ where: { clientAccountId } }), 1);
    const stored = await prisma.clientAccount.findUnique({ where: { clientAccountId } });
    assert.deepEqual(stored?.primaryNicheKeys, ["VET"]);
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
  }
});

test("missing field policy accepts explicit missing funnel-ID notes", () => {
  const missing = missingClientSetupFields(
    { primaryNicheKeys: ["HEALTH"], primaryProductTypes: ["exclusive"] },
    {
      sourceProvider: "nextgen",
      trafficSourceName: "NextGen",
      nextgenFunnelName: "Health funnel",
      nextgenFunnelUrl: "https://example.test/funnel",
      sourceMissingInfoNotes: "Provider does not expose a funnel ID yet.",
      testLeadUuid: crypto.randomUUID(),
      testSubmissionAt: "2026-09-30T12:00:00-04:00",
      webhookConfigured: true,
      sourceTestSubmitted: true,
      destinationChoice: "undecided",
    }
  );
  assert.deepEqual(missing, []);
});

test("request IDs bind to client, intent, payload, and original immutable result", async () => {
  const firstClientId = `setup_idempotency_a_${Date.now()}`;
  const secondClientId = `setup_idempotency_b_${Date.now()}`;
  const requestId = crypto.randomUUID();
  await prisma.clientAccount.createMany({
    data: [
      { clientAccountId: firstClientId, clientDisplayName: "First idempotency client" },
      { clientAccountId: secondClientId, clientDisplayName: "Second idempotency client" },
    ],
  });
  try {
    const payload = { geography: "North" };
    const [first, repeatedClick] = await Promise.all([
      saveClientOnboardingSetup(firstClientId, {
        requestId,
        expectedRevision: 0,
        intent: "save_draft",
        data: payload,
      }),
      saveClientOnboardingSetup(firstClientId, {
        requestId,
        expectedRevision: 0,
        intent: "save_draft",
        data: payload,
      }),
    ]);
    assert.equal(first.ok, true);
    assert.equal(repeatedClick.ok, true);
    assert.deepEqual(
      [first, repeatedClick].map((result) => result.ok && result.replayed).sort(),
      [false, true]
    );

    const intervening = await saveClientOnboardingSetup(firstClientId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      intent: "save_draft",
      data: { geography: "South" },
    });
    assert.equal(intervening.ok, true);

    const timeoutRetry = await saveClientOnboardingSetup(firstClientId, {
      requestId,
      expectedRevision: 0,
      intent: "save_draft",
      data: payload,
    });
    assert.equal(timeoutRetry.ok, true);
    if (timeoutRetry.ok) {
      assert.equal(timeoutRetry.replayed, true);
      assert.equal(timeoutRetry.item.revision, 1);
      assert.equal(timeoutRetry.item.data.geography, "North");
    }
    assert.equal(
      (await getClientOnboardingSetup(firstClientId))?.data.geography,
      "South"
    );

    for (const mismatch of [
      { clientAccountId: firstClientId, intent: "save_draft" as const, data: { geography: "West" } },
      { clientAccountId: firstClientId, intent: "submit" as const, data: payload },
      { clientAccountId: secondClientId, intent: "save_draft" as const, data: payload },
    ]) {
      const result = await saveClientOnboardingSetup(mismatch.clientAccountId, {
        requestId,
        expectedRevision: 0,
        intent: mismatch.intent,
        data: mismatch.data,
      });
      assert.equal(result.ok, false);
      if (!result.ok) assert.equal(result.code, "REQUEST_ID_CONFLICT");
    }
    assert.equal(
      await prisma.clientOnboardingSetupAuditEvent.count({ where: { requestId } }),
      1
    );
  } finally {
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [firstClientId, secondClientId] } },
    });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: { in: [firstClientId, secondClientId] } },
    });
  }
});

test("optimistic revisions reject overlapping editors and simultaneous first saves", async () => {
  const clientAccountId = `setup_concurrency_${Date.now()}`;
  const firstSaveClientId = `setup_first_save_${Date.now()}`;
  await prisma.clientAccount.createMany({
    data: [
      { clientAccountId, clientDisplayName: "Concurrent Editors" },
      { clientAccountId: firstSaveClientId, clientDisplayName: "First Saves" },
    ],
  });
  try {
    const initial = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      intent: "save_draft",
      data: { geography: "Original" },
    });
    assert.equal(initial.ok, true);

    const editorOne = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      intent: "save_draft",
      data: { geography: "Editor one" },
    });
    assert.equal(editorOne.ok, true);
    const editorTwo = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      intent: "save_draft",
      data: { geography: "Editor two" },
    });
    assert.equal(editorTwo.ok, false);
    if (!editorTwo.ok) assert.equal(editorTwo.code, "STALE_WRITE");
    assert.equal((await getClientOnboardingSetup(clientAccountId))?.data.geography, "Editor one");

    const simultaneous = await Promise.all([
      saveClientOnboardingSetup(firstSaveClientId, {
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        intent: "save_draft",
        data: { setupOwner: "Editor A" },
      }),
      saveClientOnboardingSetup(firstSaveClientId, {
        requestId: crypto.randomUUID(),
        expectedRevision: 0,
        intent: "save_draft",
        data: { setupOwner: "Editor B" },
      }),
    ]);
    assert.equal(simultaneous.filter((result) => result.ok).length, 1);
    assert.equal(
      simultaneous.filter((result) => !result.ok && result.code === "STALE_WRITE").length,
      1
    );
  } finally {
    await prisma.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientAccountId, firstSaveClientId] } },
    });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: { in: [clientAccountId, firstSaveClientId] } },
    });
  }
});

test("unreadable persisted JSON is surfaced and cannot be overwritten by an ordinary save", async () => {
  const clientAccountId = `setup_repair_${Date.now()}`;
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Repair Required" },
  });
  const rawDocument = { clientEmail: "not-an-email", unknownLegacyKey: "retain me" };
  try {
    await prisma.clientOnboardingSetup.create({
      data: { clientAccountId, setupDataJson: rawDocument },
    });
    const loaded = await getClientOnboardingSetup(clientAccountId);
    assert.equal(loaded?.repairRequired, true);
    assert.deepEqual(loaded?.data, {});
    assert.equal(JSON.stringify(loaded).includes("retain me"), false);

    const blocked = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      intent: "save_draft",
      data: { geography: "Must not overwrite" },
    });
    assert.equal(blocked.ok, false);
    if (!blocked.ok) assert.equal(blocked.code, "SETUP_REPAIR_REQUIRED");
    const unchanged = await prisma.clientOnboardingSetup.findUnique({
      where: { clientAccountId },
    });
    assert.deepEqual(unchanged?.setupDataJson, rawDocument);

    const recoveryRequestId = crypto.randomUUID();
    const recovered = await saveClientOnboardingSetup(clientAccountId, {
      requestId: recoveryRequestId,
      expectedRevision: 1,
      intent: "recover_draft",
      data: {},
    });
    assert.equal(recovered.ok, true);
    if (recovered.ok) {
      assert.equal(recovered.item.repairRequired, false);
      assert.equal(recovered.item.revision, 2);
    }
    await prisma.clientAccount.delete({ where: { clientAccountId } });
    const recoveryAudit = await prisma.clientOnboardingSetupAuditEvent.findUniqueOrThrow({
      where: { requestId: recoveryRequestId },
    });
    assert.equal(recoveryAudit.setupId, null);
    assert.deepEqual(
      (recoveryAudit.changesJson as { recoveryBackup?: unknown }).recoveryBackup,
      rawDocument
    );
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: clientAccountId },
    });
  }
});

test("content-changing draft saves invalidate submitted, needs-information, and reviewed states", async () => {
  const clientAccountId = `setup_transitions_${Date.now()}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Transition Test",
      primaryNicheKeys: ["VET"],
      primaryProductTypes: ["final_expense"],
    },
  });
  try {
    const prematureReview = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      intent: "setup_reviewed",
      data: { reviewNotes: "Cannot review before submission." },
    });
    assert.equal(prematureReview.ok, false);
    if (!prematureReview.ok) assert.equal(prematureReview.code, "VALIDATION");

    const submitted = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 0,
      intent: "submit",
      data: {
        sourceProvider: "other",
        trafficSourceName: "Referral",
        destinationChoice: "intake_only",
      },
    });
    assert.equal(submitted.ok, true);
    if (!submitted.ok) return;
    const submittedAt = submitted.item.submittedAt;
    assert.ok(submittedAt);

    const reviewed = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 1,
      intent: "setup_reviewed",
      data: { reviewNotes: "Reviewed against request." },
    });
    assert.equal(reviewed.ok, true);
    if (!reviewed.ok) return;
    assert.ok(reviewed.item.reviewedAt);

    const noOp = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 2,
      intent: "save_draft",
      data: {},
    });
    assert.equal(noOp.ok, true);
    if (!noOp.ok) return;
    assert.equal(noOp.item.status, "setup_reviewed");
    assert.equal(noOp.item.revision, 2);
    assert.equal(noOp.item.reviewedAt, reviewed.item.reviewedAt);

    const changedReviewed = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 2,
      intent: "save_draft",
      data: { geography: "Changed after review" },
    });
    assert.equal(changedReviewed.ok, true);
    if (!changedReviewed.ok) return;
    assert.equal(changedReviewed.item.status, "draft");
    assert.equal(changedReviewed.item.submittedAt, null);
    assert.equal(changedReviewed.item.reviewedAt, null);

    const resubmitted = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 3,
      intent: "submit",
      data: {},
    });
    assert.equal(resubmitted.ok, true);
    if (!resubmitted.ok) return;
    assert.ok(resubmitted.item.submittedAt);

    const needsInformation = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 4,
      intent: "needs_information",
      data: { reviewNotes: "Please clarify geography." },
    });
    assert.equal(needsInformation.ok, true);
    if (!needsInformation.ok) return;
    assert.equal(needsInformation.item.submittedAt, resubmitted.item.submittedAt);

    const changedNeedsInformation = await saveClientOnboardingSetup(clientAccountId, {
      requestId: crypto.randomUUID(),
      expectedRevision: 5,
      intent: "save_draft",
      data: { geography: "Clarified" },
    });
    assert.equal(changedNeedsInformation.ok, true);
    if (!changedNeedsInformation.ok) return;
    assert.equal(changedNeedsInformation.item.status, "draft");
    assert.equal(changedNeedsInformation.item.submittedAt, null);
    assert.equal(changedNeedsInformation.item.reviewedAt, null);
  } finally {
    await prisma.clientAccount.delete({ where: { clientAccountId } });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: clientAccountId },
    });
  }
});

test("client deletion removes mutable setup while retaining attributed audit history", async () => {
  const clientAccountId = `setup_delete_${Date.now()}`;
  await prisma.clientAccount.create({
    data: { clientAccountId, clientDisplayName: "Deletion Audit" },
  });
  const firstRequestId = crypto.randomUUID();
  try {
    for (const [index, geography] of ["One", "Two", "Three"].entries()) {
      const result = await saveClientOnboardingSetup(clientAccountId, {
        requestId: index === 0 ? firstRequestId : crypto.randomUUID(),
        expectedRevision: index,
        intent: "save_draft",
        data: { geography },
      });
      assert.equal(result.ok, true);
    }
    const impact = await getClientDeletionImpact(clientAccountId);
    assert.equal("notFound" in impact, false);
    if ("notFound" in impact) return;
    assert.equal(impact.counts.onboardingSetups, 1);
    assert.equal(impact.counts.onboardingAuditEventsRetained, 3);
    assert.match(impact.warning, /mutable onboarding setup document will be deleted/i);
    assert.match(impact.warning, /audit event\(s\) will be retained/i);

    const deleted = await deleteClientAdmin(clientAccountId, true);
    assert.equal("deleted" in deleted && deleted.deleted, true);
    assert.equal(
      await prisma.clientOnboardingSetup.count({ where: { clientAccountId } }),
      0
    );
    const retained = await prisma.clientOnboardingSetupAuditEvent.findMany({
      where: { historicalClientAccountId: clientAccountId },
    });
    assert.equal(retained.length, 3);
    assert.ok(retained.every((event) => event.setupId === null));
    assert.ok(retained.every((event) => event.clientAccountId === clientAccountId));

    await prisma.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "Recreated identity" },
    });
    const oldReplay = await saveClientOnboardingSetup(clientAccountId, {
      requestId: firstRequestId,
      expectedRevision: 0,
      intent: "save_draft",
      data: { geography: "One" },
    });
    assert.equal(oldReplay.ok, false);
    if (!oldReplay.ok) assert.equal(oldReplay.code, "REQUEST_ID_CONFLICT");
  } finally {
    await prisma.clientAccount.deleteMany({ where: { clientAccountId } });
    await prisma.clientOnboardingSetupAuditEvent.deleteMany({
      where: { historicalClientAccountId: clientAccountId },
    });
  }
});

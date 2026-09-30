import assert from "node:assert/strict";
import test from "node:test";

import { prisma } from "../lib/db.js";
import {
  getClientOnboardingSetup,
  missingClientSetupFields,
  saveClientOnboardingSetup,
} from "./client-onboarding-setup.service.js";
import { createClientAdmin } from "./client-account.service.js";

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
      intent: "save_draft",
      data: { trafficSourceName: "must not overwrite" },
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

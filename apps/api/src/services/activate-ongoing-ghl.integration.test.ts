/**
 * Local sa360_test proof that ongoing GHL activation is persisted and audited.
 * Placeholder ciphertext is stored and never asserted as a secret value.
 */
import assert from "node:assert/strict";
import { after, before, describe, it } from "node:test";

import { PrismaClient } from "@prisma/client";

import { assertSafeTestDatabaseUrl } from "../lib/safe-test-database-url.js";
import { ENABLE_ONGOING_GHL_DELIVERY } from "./ghl-destination-authorization.js";
import { activateOngoingGhlDelivery } from "./activate-ongoing-ghl.js";

const integrationUrlRaw = process.env.SA360_TEST_DATABASE_URL?.trim() || "";
const runIntegration = Boolean(integrationUrlRaw);

describe("ongoing GHL activation is audited on the saved location", { skip: !runIntegration }, () => {
  let db: PrismaClient;
  const stamp = `${Date.now()}`;
  const clientAccountId = `ghl_on_${stamp}`;
  const otherClientAccountId = `ghl_other_${stamp}`;
  const locationId = `loc_pilot_${stamp}`;
  const requestId = `req_on_${stamp}`;

  before(async () => {
    assertSafeTestDatabaseUrl(integrationUrlRaw);
    db = new PrismaClient({ datasources: { db: { url: integrationUrlRaw } } });
    await db.clientAccount.create({
      data: { clientAccountId, clientDisplayName: "Pilot Activation", status: "onboarding" },
    });
    await db.clientAccount.create({
      data: { clientAccountId: otherClientAccountId, clientDisplayName: "Other Activation", status: "onboarding" },
    });
    await db.clientGhlDestination.create({
      data: {
        clientAccountId,
        destinationSubaccountIdGhl: locationId,
        locationName: "Saved test location",
        destinationWorkflowIdGhl: "wf_saved",
        workflowTriggerMode: "direct_api",
        opportunityCreationEnabled: false,
        deliveryMode: "shadow",
        deliveryEnabled: false,
        clientCutoverApproved: false,
        internalApprovalStatus: "not_reviewed",
        ghlConnectionStatus: "connected",
      },
    });
    await db.ghlLocationConnection.create({
      data: {
        clientAccountId,
        locationId,
        locationName: "Saved test location",
        accessTokenEncrypted: "enc-test-token",
        refreshTokenEncrypted: "enc-test-refresh",
        tokenExpiresAt: new Date("2027-01-01T00:00:00.000Z"),
        connectionStatus: "connected",
      },
    });
  });

  after(async () => {
    await db.ghlLocationConnection.deleteMany({ where: { locationId } });
    await db.clientAccount.deleteMany({
      where: { clientAccountId: { in: [clientAccountId, otherClientAccountId] } },
    });
    await db.$disconnect();
  });

  it("sets the four live flags once and refuses another client on that location", async () => {
    const wrong = await activateOngoingGhlDelivery(
      { clientAccountId, requestId, confirmation: "no", actorLabel: "operator" },
      db
    );
    assert.equal(wrong.ok, false);

    const activated = await activateOngoingGhlDelivery(
      {
        clientAccountId,
        requestId,
        confirmation: ENABLE_ONGOING_GHL_DELIVERY,
        actorLabel: "operator",
      },
      db
    );
    assert.equal(activated.ok, true);
    if (!activated.ok) return;
    assert.equal(activated.locationId, locationId);
    assert.equal(activated.deliveryEnabled, true);
    assert.equal(activated.alreadyActive, false);

    const saved = await db.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId } });
    assert.equal(saved.deliveryEnabled, true);
    assert.equal(saved.deliveryMode, "live");
    assert.equal(saved.clientCutoverApproved, true);
    assert.equal(saved.internalApprovalStatus, "approved");
    assert.equal(saved.destinationSubaccountIdGhl, locationId);

    const audit = await db.clientOnboardingV2AuditEvent.findUniqueOrThrow({ where: { requestId } });
    assert.equal(audit.action, "activate_ghl_ongoing");
    assert.equal(audit.auth, "admin_api_key");
    assert.deepEqual(audit.destinations, []);

    const replay = await activateOngoingGhlDelivery(
      { clientAccountId, requestId, confirmation: ENABLE_ONGOING_GHL_DELIVERY },
      db
    );
    assert.equal(replay.ok, true);
    if (!replay.ok) return;
    assert.equal(replay.alreadyActive, false);
    assert.equal(await db.clientOnboardingV2AuditEvent.count({ where: { requestId } }), 1);

    await db.clientGhlDestination.create({
      data: {
        clientAccountId: otherClientAccountId,
        destinationSubaccountIdGhl: locationId,
        destinationWorkflowIdGhl: "wf_other",
        workflowTriggerMode: "direct_api",
        opportunityCreationEnabled: false,
        deliveryEnabled: false,
        deliveryMode: "shadow",
      },
    });
    await db.ghlLocationConnection.update({
      where: { locationId },
      data: { clientAccountId: otherClientAccountId },
    });
    const blocked = await activateOngoingGhlDelivery(
      {
        clientAccountId: otherClientAccountId,
        requestId: `req_other_${stamp}`,
        confirmation: ENABLE_ONGOING_GHL_DELIVERY,
      },
      db
    );
    assert.equal(blocked.ok, false);
    if (blocked.ok) return;
    assert.equal(blocked.error, "location_owned_by_other_client");
    const other = await db.clientGhlDestination.findUniqueOrThrow({ where: { clientAccountId: otherClientAccountId } });
    assert.equal(other.deliveryEnabled, false);
  });
});

import assert from "node:assert/strict";
import { after, test } from "node:test";

import { prisma } from "../../lib/db.js";
import { deleteClientAdmin } from "../client-account.service.js";
import { getClientDeletionImpact } from "./client-deletion-impact.service.js";

const clientIds: string[] = [];

after(async () => {
  if (clientIds.length === 0) return;
  await prisma.deliverySuccessNotification
    .deleteMany({ where: { clientAccountId: { in: clientIds } } })
    .catch(() => undefined);
  await prisma.clientDeliveryNotificationPreference
    .deleteMany({ where: { clientAccountId: { in: clientIds } } })
    .catch(() => undefined);
  await prisma.clientCustomWebhookDestination
    .deleteMany({ where: { clientAccountId: { in: clientIds } } })
    .catch(() => undefined);
  await prisma.clientAccount.deleteMany({ where: { clientAccountId: { in: clientIds } } }).catch(() => undefined);
});

async function createClient(label: string): Promise<string> {
  const clientAccountId = `deliv_del_${label}_${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
  await prisma.clientAccount.create({
    data: {
      clientAccountId,
      clientDisplayName: "Deletion impact",
      status: "onboarding",
    },
  });
  clientIds.push(clientAccountId);
  return clientAccountId;
}

test("client deletion impact blocks on notification history and cascades configuration", async () => {
  const protectedId = await createClient("history");
  await prisma.clientDeliveryNotificationPreference.create({
    data: { clientAccountId: protectedId, recipientEmail: "owner@example.com" },
  });
  await prisma.deliverySuccessNotification.create({
    data: {
      clientAccountId: protectedId,
      sourceLeadEventId: "lead_history",
      idempotencyKey: `client_lead:${protectedId}:lead_history`,
      sheetsJobId: "job_history",
      status: "sent",
    },
  });

  const impact = await getClientDeletionImpact(protectedId);
  assert.equal("notFound" in impact, false);
  if ("notFound" in impact) return;
  assert.equal(impact.counts.deliverySuccessNotifications, 1);
  assert.equal(impact.blocked, true);
  assert.match(impact.blockers.join(" "), /delivery success notification/i);
  assert.match(impact.warning, /block deletion and are not removed/i);

  const deleted = await deleteClientAdmin(protectedId, true);
  assert.equal("code" in deleted && deleted.code, "CLIENT_HAS_DEPENDENCIES");
  assert.equal(
    await prisma.deliverySuccessNotification.count({ where: { clientAccountId: protectedId } }),
    1
  );
  assert.equal(await prisma.clientAccount.count({ where: { clientAccountId: protectedId } }), 1);

  const configurableId = await createClient("config");
  await prisma.clientDeliveryNotificationPreference.create({
    data: { clientAccountId: configurableId },
  });
  await prisma.clientCustomWebhookDestination.create({
    data: {
      clientAccountId: configurableId,
      endpointUrl: "https://hooks.example.com/lead",
      signingSecretCiphertext: "iv.tag.cipher",
      signingSecretFingerprint: "abc123",
    },
  });
  const openImpact = await getClientDeletionImpact(configurableId);
  assert.equal("notFound" in openImpact, false);
  if ("notFound" in openImpact) return;
  assert.equal(openImpact.counts.deliverySuccessNotifications, 0);
  assert.equal(openImpact.blocked, false);

  const removed = await deleteClientAdmin(configurableId, true);
  assert.equal("deleted" in removed && removed.deleted, true);
  assert.equal(await prisma.clientAccount.count({ where: { clientAccountId: configurableId } }), 0);
  assert.equal(
    await prisma.clientDeliveryNotificationPreference.count({ where: { clientAccountId: configurableId } }),
    0
  );
  assert.equal(
    await prisma.clientCustomWebhookDestination.count({ where: { clientAccountId: configurableId } }),
    0
  );
});

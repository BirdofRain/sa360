import type { Job } from "bullmq";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { buildMetaPayload } from "../services/meta-transform.service.js";
import { sendToMeta } from "../services/meta-client.service.js";
import { logDispatchAttempt } from "../services/dispatch-log.service.js";
import type { LifecycleWebhookPayload } from "@sa360/shared";

export async function processMetaDispatch(job: Job<{ eventUuid: string }>) {
  const { eventUuid } = job.data;

  const event = await prisma.lifecycleEvent.findUnique({
    where: { eventUuid },
  });

  if (!event) {
    throw new Error(`Lifecycle event not found for ${eventUuid}`);
  }

  const payload = event.payloadJson as unknown as LifecycleWebhookPayload;

  const client = await prisma.clientConfig.findUnique({
    where: { clientAccountId: event.clientAccountId },
  });

  if (!client) {
    throw new Error(`Client config not found for ${event.clientAccountId}`);
  }

  if (!client.metaSyncEnabled) {
    logger.info("Meta sync disabled for client", client.clientAccountId);
    return;
  }

  if (!client.metaDatasetId || !client.metaAccessToken) {
    throw new Error(`Missing Meta config for client ${client.clientAccountId}`);
  }

  const metaPayload = buildMetaPayload(payload);

  const result = await sendToMeta(
    client.metaDatasetId,
    client.metaAccessToken,
    metaPayload
  );

  await logDispatchAttempt({
    eventUuid,
    attemptNumber: job.attemptsMade + 1,
    requestJson: metaPayload,
    responseJson: result.body,
    httpStatus: result.status,
    success: result.ok,
    errorMessage: result.ok ? undefined : "Meta request failed",
  });

  if (!result.ok) {
    throw new Error(`Meta dispatch failed with status ${result.status}`);
  }

  await prisma.lifecycleEvent.update({
    where: { eventUuid },
    data: {
      status: "processed",
      processedAt: new Date(),
    },
  });

  logger.info("Meta dispatch success", { eventUuid, status: result.status });
}
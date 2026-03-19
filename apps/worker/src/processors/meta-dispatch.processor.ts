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

  if (!payload?.event?.send_to_meta) {
    logger.info("Event flagged not to send to Meta", {
      eventUuid,
      clientAccountId: event.clientAccountId,
      eventNameInternal: payload?.event?.event_name_internal,
      eventNameMeta: payload?.event?.event_name_meta,
    });
    return;
  } 

  const client = await prisma.clientConfig.findUnique({
    where: { clientAccountId: event.clientAccountId },
  });

  if (!client) {
    logger.error("Client config not found", {
      eventUuid,
      clientAccountId: event.clientAccountId,
    });
    throw new Error(`Client config not found for ${event.clientAccountId}`);
  }

  if (!client.metaSyncEnabled) {
    logger.info("Meta sync disabled for client", {
      eventUuid,
      clientAccountId: client.clientAccountId,
    });
    return;
  }

  const datasetId =
    payload.routing?.master_dataset_id ||
    payload.routing?.source_dataset_id ||
    client.metaDatasetId;

  const accessToken = client.metaAccessToken;

  if (!datasetId || !accessToken) {
    logger.error("Missing Meta config for dispatch", {
      eventUuid,
      clientAccountId: client.clientAccountId,
      hasRoutingMasterDataset: !!payload.routing?.master_dataset_id,
      hasRoutingSourceDataset: !!payload.routing?.source_dataset_id,
      hasClientDatasetFallback: !!client.metaDatasetId,
      hasAccessToken: !!accessToken,
    });
    throw new Error(`Missing Meta config for dispatch ${client.clientAccountId}`);
  }

  const metaPayload = buildMetaPayload(payload);

  logger.info("Sending event to Meta", {
    eventUuid,
    clientAccountId: client.clientAccountId,
    eventNameInternal: payload.event.event_name_internal,
    eventNameMeta: payload.event.event_name_meta,
    datasetId,
    routing: payload.routing,
  });

  const result = await sendToMeta(
    datasetId,
    accessToken,
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
    logger.error("Meta dispatch failed", {
      eventUuid,
      clientAccountId: client.clientAccountId,
      status: result.status,
    });
    throw new Error(`Meta dispatch failed with status ${result.status}`);
  }

  await prisma.lifecycleEvent.update({
    where: { eventUuid },
    data: {
      status: "processed",
      processedAt: new Date(),
    },
  });

  logger.info("Meta dispatch success", {
    eventUuid,
    clientAccountId: client.clientAccountId,
    status: result.status,
    eventNameInternal: payload.event.event_name_internal,
    eventNameMeta: payload.event.event_name_meta,
  });
}
import type { Job } from "bullmq";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import { logM1AEvent } from "../lib/m1a-event-log.js";
import { buildMetaPayload } from "../services/meta-transform.service.js";
import { sendToMeta } from "../services/meta-client.service.js";
import { logDispatchAttempt } from "../services/dispatch-log.service.js";
import type { LifecycleWebhookPayload } from "@sa360/shared";

export async function processMetaDispatch(job: Job<{ eventUuid: string }>) {
  const job_id = String(job.id);
  const request_id = `worker:${job_id}`;
  const { eventUuid } = job.data;

  logM1AEvent("worker.job.received", null, {
    job_id,
    request_id,
    status: "received",
    event_uuid: eventUuid,
  });

  const event = await prisma.lifecycleEvent.findUnique({
    where: { eventUuid },
  });

  if (!event) {
    throw new Error(`Lifecycle event not found for ${eventUuid}`);
  }

  const payload = event.payloadJson as unknown as LifecycleWebhookPayload;

  logM1AEvent("worker.event.loaded", payload, {
    job_id,
    request_id,
    status: "loaded",
  });

  if (!payload?.event?.send_to_meta) {
    logM1AEvent("worker.meta.skipped_disabled", payload, {
      job_id,
      request_id,
      status: "skipped",
      skip_reason: "send_to_meta_false",
    });
    logM1AEvent("worker.job.completed", payload, {
      job_id,
      request_id,
      status: "skipped",
      worker_final_status: "skipped",
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
    logM1AEvent("worker.meta.skipped_disabled", payload, {
      job_id,
      request_id,
      status: "skipped",
      skip_reason: "client_meta_sync_disabled",
    });
    logM1AEvent("worker.job.completed", payload, {
      job_id,
      request_id,
      status: "skipped",
      worker_final_status: "skipped",
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

  logM1AEvent("worker.meta.dispatch.started", payload, {
    job_id,
    request_id,
    status: "dispatching",
  });

  logger.info("Sending event to Meta", {
    eventUuid,
    clientAccountId: event.clientAccountId,
    eventNameInternal: payload.event.event_name_internal,
    eventNameMeta: payload.event.event_name_meta,
    datasetId,
    routing: payload.routing,
  });

  const result = await sendToMeta(datasetId, accessToken, metaPayload);

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
    logM1AEvent("worker.meta.dispatch.failed", payload, {
      job_id,
      request_id,
      status: "failed",
      http_status: result.status,
      log_level: "error",
    });
    logger.error("Meta dispatch failed", {
      eventUuid,
      clientAccountId: event.clientAccountId,
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

  logM1AEvent("worker.meta.dispatch.success", payload, {
    job_id,
    request_id,
    status: "dispatched",
    http_status: result.status,
  });

  logger.info("Meta dispatch success", {
    eventUuid,
    clientAccountId: event.clientAccountId,
    status: result.status,
    eventNameInternal: payload.event.event_name_internal,
    eventNameMeta: payload.event.event_name_meta,
  });

  logM1AEvent("worker.job.completed", payload, {
    job_id,
    request_id,
    status: "dispatched",
    worker_final_status: "dispatched",
  });
}

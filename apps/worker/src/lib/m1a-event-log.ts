import type { LifecycleWebhookPayload } from "@sa360/shared";
import {
  extractSafeM1ALogFields,
  extractSafeM1ALogFieldsFromUnknown,
  type M1AStage,
} from "@sa360/shared";
import { logger } from "./logger.js";

const SERVICE = "sa360-worker" as const;
const MODULE = "M1A";
/** Same component key as API M1A logs so Live Tail filters stay unified. */
const COMPONENT = "ghl-lifecycle-webhook";

export type M1AWorkerLogExtra = {
  /** BullMQ job id (searchable correlation). */
  job_id: string;
  /** Optional; defaults to `worker:${job_id}` for Live Tail consistency with API `request_id`. */
  request_id?: string;
  status?: string;
  bodyPreview?: unknown;
  log_level?: "debug" | "info" | "warn" | "error";
} & Record<string, unknown>;

function resolveLogLevel(
  stage: M1AStage,
  extra: M1AWorkerLogExtra
): "debug" | "info" | "warn" | "error" {
  if (extra.log_level) return extra.log_level;
  if (
    stage === "m1a.webhook.failed" ||
    stage === "worker.job.failed" ||
    stage === "worker.meta.dispatch.failed"
  ) {
    return "error";
  }
  return "info";
}

export function logM1AEvent(
  stage: M1AStage,
  payload: LifecycleWebhookPayload | null,
  extra: M1AWorkerLogExtra
): void {
  const { job_id, request_id: ridIn, bodyPreview, log_level: _omit, ...rest } =
    extra;
  const request_id = ridIn ?? `worker:${job_id}`;

  const safe = payload
    ? extractSafeM1ALogFields(payload)
    : extractSafeM1ALogFieldsFromUnknown(bodyPreview);

  const level = resolveLogLevel(stage, extra);

  const meta: Record<string, unknown> = {
    service: SERVICE,
    module: MODULE,
    component: COMPONENT,
    env: process.env.SA360_ENV ?? process.env.NODE_ENV ?? "development",
    stage,
    request_id,
    job_id,
    ...safe,
    ...rest,
  };

  logger[level](stage, meta);
}

import type { LifecycleWebhookPayload } from "@sa360/shared";
import {
  extractSafeM1ALogFields,
  extractSafeM1ALogFieldsFromUnknown,
  type M1AStage,
} from "@sa360/shared";
import { logger } from "./logger.js";

const SERVICE = "sa360-api" as const;
const MODULE = "M1A";
const COMPONENT = "ghl-lifecycle-webhook";

export type M1AWebhookLogExtra = {
  request_id: string;
  status?: string;
  valid?: boolean;
  bodyPreview?: unknown;
  log_level?: "debug" | "info" | "warn" | "error";
} & Record<string, unknown>;

function resolveLogLevel(
  stage: M1AStage,
  extra: M1AWebhookLogExtra
): "debug" | "info" | "warn" | "error" {
  if (extra.log_level) return extra.log_level;
  if (
    stage === "m1a.webhook.failed" ||
    stage === "worker.job.failed" ||
    stage === "worker.meta.dispatch.failed"
  ) {
    return "error";
  }
  if (
    stage === "m1a.contact_index.failed" ||
    stage === "m1a.duplicate.index_upsert.failed"
  ) {
    return "warn";
  }
  if (extra.valid === false) return "warn";
  return "info";
}

/**
 * Structured M1A / GHL lifecycle telemetry. Never pass secrets in `payload` / `extra`.
 * Use `bodyPreview` only for invalid JSON shape analysis; it is not copied to Logtail meta.
 */
export function logM1AEvent(
  stage: M1AStage,
  payload: LifecycleWebhookPayload | null,
  extra: M1AWebhookLogExtra
): void {
  const { request_id, bodyPreview, log_level: _omit, ...restForMeta } = extra;

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
    ...safe,
    ...restForMeta,
  };

  logger[level](stage, meta);
}

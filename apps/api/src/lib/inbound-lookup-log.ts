import { logger } from "./logger.js";

/** Shared shape for lifecycle + Synthflow + index cache debugging (no secrets / full payloads). */
export type InboundLookupLogFields = {
  event: string;
  component: string;
  clientAccountId?: string;
  subaccountIdGhl?: string;
  caller_phone_e164?: string;
  to_phone_e164?: string;
  eventUuid?: string;
  lookup_status?: string;
  /** Last 4 digits when full E164 is omitted */
  caller_phone_suffix?: string;
  to_phone_suffix?: string;
  error_name?: string;
  message?: string;
  reason?: string;
  ghl_outcome?: string;
} & Record<string, string | number | boolean | undefined>;

function emit(level: "info" | "warn" | "error", message: string, fields: InboundLookupLogFields) {
  const meta = { ...fields };
  if (level === "error") {
    logger.error(message, meta);
    return;
  }
  if (level === "warn") {
    logger.warn(message, meta);
    return;
  }
  logger.info(message, meta);
}

export function logInboundLookupInfo(message: string, fields: InboundLookupLogFields) {
  emit("info", message, fields);
}

export function logInboundLookupWarn(message: string, fields: InboundLookupLogFields) {
  emit("warn", message, fields);
}

export function logInboundLookupError(message: string, fields: InboundLookupLogFields) {
  emit("error", message, fields);
}

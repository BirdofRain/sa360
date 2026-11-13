/**
 * Isolated Twilio Programmable Messaging adapter.
 *
 * Nothing in the API server, the worker, or the delivery scanner imports this
 * module. `postTwilioProgrammableMessage` has no default fetch, so loading the
 * file cannot send. SMS stays off unless `SA360_SMS_NOTIFICATIONS_ENABLED` is
 * the exact string "true", and even then a caller must pass a client.
 */

export const SMS_NOTIFICATIONS_ENABLED_ENV = "SA360_SMS_NOTIFICATIONS_ENABLED";
export const TWILIO_ACCOUNT_SID_ENV = "SA360_TWILIO_ACCOUNT_SID";
export const TWILIO_AUTH_TOKEN_ENV = "SA360_TWILIO_AUTH_TOKEN";
export const TWILIO_MESSAGING_SERVICE_SID_ENV = "SA360_TWILIO_MESSAGING_SERVICE_SID";
export const TWILIO_SMS_FROM_ENV = "SA360_TWILIO_SMS_FROM";

export const TWILIO_API_HOST = "https://api.twilio.com";
export const TWILIO_MESSAGES_PATH_PREFIX = "/2010-04-01/Accounts/";

const ACCOUNT_SID = /^AC[0-9a-fA-F]{32}$/;
const MESSAGING_SERVICE_SID = /^MG[0-9a-fA-F]{32}$/;
const MESSAGE_SID = /^(?:SM|MM)[0-9a-fA-F]{32}$/;
const AUTH_TOKEN = /^[0-9a-fA-F]{32}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

/**
 * Only trim() equal to the exact string "true" enables an SMS call.
 * Unset, blank, TRUE, 1, yes, and on stay off. Credentials do not enable it.
 */
export function isSmsNotificationsEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[SMS_NOTIFICATIONS_ENABLED_ENV]?.trim() === "true";
}

export type TwilioMessagingConfig = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
  from: string | null;
};

export type TwilioConfigResult =
  | { ok: true; config: TwilioMessagingConfig }
  | {
      ok: false;
      reason:
        | "incomplete"
        | "invalid_account_sid"
        | "invalid_auth_token"
        | "invalid_messaging_service_sid"
        | "invalid_sender";
    };

/**
 * Read LAL Messaging Service settings. The auth token is returned only inside
 * the config object and is never copied into a reason string.
 * `SA360_TWILIO_MESSAGING_SERVICE_SID` is the Messaging Service SID (MG...).
 * `SA360_TWILIO_SMS_FROM` is optional. When set, it must be E.164 and is sent
 * as `From` beside the Messaging Service so Twilio uses that pool sender.
 * An empty from lets the Messaging Service choose the sender.
 */
export function readTwilioMessagingConfig(env: NodeJS.ProcessEnv = process.env): TwilioConfigResult {
  const accountSid = env[TWILIO_ACCOUNT_SID_ENV]?.trim() ?? "";
  const authToken = env[TWILIO_AUTH_TOKEN_ENV]?.trim() ?? "";
  const messagingServiceSid = env[TWILIO_MESSAGING_SERVICE_SID_ENV]?.trim() ?? "";
  const fromRaw = env[TWILIO_SMS_FROM_ENV]?.trim() ?? "";
  if (!accountSid || !authToken || !messagingServiceSid) return { ok: false, reason: "incomplete" };
  if (!ACCOUNT_SID.test(accountSid)) return { ok: false, reason: "invalid_account_sid" };
  if (!AUTH_TOKEN.test(authToken)) return { ok: false, reason: "invalid_auth_token" };
  if (!MESSAGING_SERVICE_SID.test(messagingServiceSid)) {
    return { ok: false, reason: "invalid_messaging_service_sid" };
  }
  if (fromRaw && !E164.test(fromRaw)) return { ok: false, reason: "invalid_sender" };
  return {
    ok: true,
    config: {
      accountSid,
      authToken,
      messagingServiceSid,
      from: fromRaw || null,
    },
  };
}

/** Outbound Twilio Message `status` values, plus the two inbound values. */
export const TWILIO_MESSAGE_STATUSES = [
  "accepted",
  "scheduled",
  "queued",
  "sending",
  "sent",
  "delivered",
  "read",
  "undelivered",
  "failed",
  "canceled",
  "receiving",
  "received",
  "partially_delivered",
] as const;

export type TwilioMessageStatus = (typeof TWILIO_MESSAGE_STATUSES)[number];

export type SmsStatusClass = "pending" | "sent" | "failed" | "inbound" | "unknown";

const STATUS_CLASS: Record<TwilioMessageStatus, SmsStatusClass> = {
  accepted: "pending",
  scheduled: "pending",
  queued: "pending",
  sending: "pending",
  sent: "sent",
  delivered: "sent",
  read: "sent",
  undelivered: "failed",
  failed: "failed",
  canceled: "failed",
  partially_delivered: "failed",
  receiving: "inbound",
  received: "inbound",
};

export function mapTwilioMessageStatus(status: string): TwilioMessageStatus | "unknown" {
  const normalized = status.trim().toLowerCase();
  if ((TWILIO_MESSAGE_STATUSES as readonly string[]).includes(normalized)) {
    return normalized as TwilioMessageStatus;
  }
  return "unknown";
}

export function classifyTwilioMessageStatus(status: string): SmsStatusClass {
  const mapped = mapTwilioMessageStatus(status);
  if (mapped === "unknown") return "unknown";
  return STATUS_CLASS[mapped];
}

export type TwilioErrorClass =
  | "stop_suppressed"
  | "invalid_destination"
  | "permission_denied"
  | "authentication"
  | "rate_limited"
  | "unreachable"
  | "carrier_filtered"
  | "provider_rejected"
  | "transport";

const STOP_CODES = new Set([21610]);
const INVALID_DESTINATION_CODES = new Set([21211, 21217, 21401, 21612, 21614]);
const PERMISSION_CODES = new Set([21408]);
const AUTH_CODES = new Set([20003, 20404]);
const RATE_CODES = new Set([20429]);
const UNREACHABLE_CODES = new Set([30003, 30005, 30006]);
const CARRIER_CODES = new Set([30007, 30034]);

export function classifyTwilioErrorCode(code: number | null): TwilioErrorClass {
  if (code == null) return "provider_rejected";
  if (STOP_CODES.has(code)) return "stop_suppressed";
  if (INVALID_DESTINATION_CODES.has(code)) return "invalid_destination";
  if (PERMISSION_CODES.has(code)) return "permission_denied";
  if (AUTH_CODES.has(code)) return "authentication";
  if (RATE_CODES.has(code)) return "rate_limited";
  if (UNREACHABLE_CODES.has(code)) return "unreachable";
  if (CARRIER_CODES.has(code)) return "carrier_filtered";
  return "provider_rejected";
}

export type TwilioCreateMessageRequest = {
  accountSid: string;
  authToken: string;
  messagingServiceSid: string;
  to: string;
  body: string;
  from: string | null;
};

export type TwilioPostResult =
  | {
      ok: true;
      provider: "twilio";
      providerMessageId: string;
      providerStatus: TwilioMessageStatus | "unknown";
      statusClass: SmsStatusClass;
    }
  | {
      ok: false;
      provider: "twilio";
      skipped: false;
      errorClass: TwilioErrorClass;
      /** Status and code only. The provider body is not copied: it can echo the destination number. */
      error: string;
      providerCode: number | null;
      providerMessageId: string | null;
      providerStatus: TwilioMessageStatus | "unknown" | null;
    };

/** Fields that may leave the adapter. The auth token is not one of them. */
export type TwilioOutboundMessage = {
  to: string;
  body: string;
  messagingServiceSid: string;
  from: string | null;
};

export type TwilioMessageClient = {
  postMessage(message: TwilioOutboundMessage): Promise<TwilioPostResult>;
};

/**
 * POST one Programmable Messaging message. `fetchImpl` is required so the
 * default path cannot be global fetch. This function does not consult the
 * kill switch; callers must refuse before invoking it while SMS is disabled.
 * The SA360 idempotency key is not a Twilio parameter. Twilio's
 * `I-Twilio-Idempotency-Token` header is a webhook delivery id, not a create
 * dedupe key on this resource.
 */
export async function postTwilioProgrammableMessage(
  request: TwilioCreateMessageRequest,
  fetchImpl: typeof fetch
): Promise<TwilioPostResult> {
  if (!ACCOUNT_SID.test(request.accountSid) || !MESSAGING_SERVICE_SID.test(request.messagingServiceSid)) {
    return failed("provider_rejected", "Twilio request rejected before send", null, null, null);
  }
  if (!E164.test(request.to) || (request.from !== null && !E164.test(request.from))) {
    return failed("invalid_destination", "Twilio request rejected before send", null, null, null);
  }
  const url = `${TWILIO_API_HOST}${TWILIO_MESSAGES_PATH_PREFIX}${request.accountSid}/Messages.json`;
  const form = new URLSearchParams({
    To: request.to,
    MessagingServiceSid: request.messagingServiceSid,
    Body: request.body,
  });
  if (request.from) form.set("From", request.from);
  const authorization = `Basic ${Buffer.from(`${request.accountSid}:${request.authToken}`, "utf8").toString("base64")}`;
  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: authorization,
        Accept: "application/json",
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: form.toString(),
    });
    return interpretTwilioResponse(response.status, await response.text());
  } catch {
    return failed("transport", "Twilio request failed", null, null, null);
  }
}

export function createTwilioMessageClient(
  config: { accountSid: string; authToken: string },
  fetchImpl: typeof fetch
): TwilioMessageClient {
  return {
    postMessage(message) {
      return postTwilioProgrammableMessage({ ...config, ...message }, fetchImpl);
    },
  };
}

function interpretTwilioResponse(httpStatus: number, bodyText: string): TwilioPostResult {
  const parsed = parseTwilioBody(bodyText);
  const providerStatus = parsed.status == null ? null : mapTwilioMessageStatus(parsed.status);
  const providerMessageId = parsed.sid;
  if ((httpStatus === 200 || httpStatus === 201) && providerMessageId && providerStatus && providerStatus !== "unknown") {
    const statusClass = classifyTwilioMessageStatus(providerStatus);
    if (statusClass === "failed" || statusClass === "inbound" || statusClass === "unknown") {
      return failed(
        classifyTwilioErrorCode(parsed.code),
        twilioErrorLabel(httpStatus, parsed.code),
        parsed.code,
        providerMessageId,
        providerStatus
      );
    }
    return {
      ok: true,
      provider: "twilio",
      providerMessageId,
      providerStatus,
      statusClass,
    };
  }
  return failed(
    classifyTwilioErrorCode(parsed.code),
    twilioErrorLabel(httpStatus, parsed.code),
    parsed.code,
    providerMessageId,
    providerStatus
  );
}

function parseTwilioBody(bodyText: string): { sid: string | null; status: string | null; code: number | null } {
  try {
    const parsed = JSON.parse(bodyText) as { sid?: unknown; status?: unknown; code?: unknown };
    const sid = typeof parsed.sid === "string" && MESSAGE_SID.test(parsed.sid) ? parsed.sid : null;
    const status = typeof parsed.status === "string" ? parsed.status : null;
    const code = typeof parsed.code === "number" && Number.isInteger(parsed.code) ? parsed.code : null;
    return { sid, status, code };
  } catch {
    return { sid: null, status: null, code: null };
  }
}

function twilioErrorLabel(httpStatus: number, code: number | null): string {
  return code == null ? `Twilio ${httpStatus}` : `Twilio ${httpStatus} code ${code}`;
}

function failed(
  errorClass: TwilioErrorClass,
  error: string,
  providerCode: number | null,
  providerMessageId: string | null,
  providerStatus: TwilioMessageStatus | "unknown" | null
): TwilioPostResult {
  return {
    ok: false,
    provider: "twilio",
    skipped: false,
    errorClass,
    error,
    providerCode,
    providerMessageId,
    providerStatus,
  };
}

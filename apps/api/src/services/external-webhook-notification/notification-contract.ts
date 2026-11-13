/**
 * Notification contract for a future Lane A external-webhook acceptance.
 *
 * This module does not query Postgres, does not write `DeliverySuccessNotification`,
 * and does not send email or SMS. Email, when a later assignment sends it, goes
 * through `sendTransactionalEmail` (Resend). There is no second email provider.
 * SMS goes through the Twilio adapter and stays skipped while the SMS flag is off.
 */

import { isSourceLeadEligibleForClientNotification } from "../delivery-success-notification/notification-claim.js";
import { isTransactionalEmailConfigured } from "../../lib/transactional-email.js";
import {
  createTwilioMessageClient,
  isSmsNotificationsEnabled,
  readTwilioMessagingConfig,
  type TwilioMessageClient,
  type TwilioPostResult,
} from "./twilio-programmable-messaging.js";

/** Same cap as Resend's Idempotency-Key slice in `sendTransactionalEmail`. */
export const EXTERNAL_WEBHOOK_IDEMPOTENCY_KEY_MAX = 256;

export const EXTERNAL_WEBHOOK_EMAIL_PROVIDER = "resend" as const;

/**
 * Fixed notices. They do not interpolate a lead, a destination URL, or an id.
 * SMS must stay one GSM-7 segment and must tell the recipient how to stop.
 */
export const EXTERNAL_WEBHOOK_SMS_TEMPLATES = {
  delivery_accepted:
    "SA360: your delivery destination accepted the webhook. Open Team Workspace for the receipt. Reply STOP to opt out.",
} as const;

export const EXTERNAL_WEBHOOK_EMAIL_TEMPLATES = {
  delivery_accepted: {
    subject: "A webhook was accepted",
    text: "SA360 received an HTTP acceptance from your delivery destination. Open Team Workspace for the receipt. This message does not include the lead.",
  },
} as const;

export type ExternalWebhookTemplateId = keyof typeof EXTERNAL_WEBHOOK_SMS_TEMPLATES;
export type ExternalWebhookNotificationChannel = "email" | "sms";

const IDENTITY = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
/** Same mailbox rule as `normalizeRecipientEmail` in notification-preference.ts. */
const RECIPIENT_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export type ExternalWebhookAcceptance = {
  /** One accepted outbound webhook event. A retry of that acceptance reuses this id. */
  acceptanceId: string;
  clientAccountId: string;
  sourceLeadEventId: string;
  destinationId: string;
  attemptId: string;
  /** HTTP status returned by the destination. Only 200–299 can notify. */
  httpStatus: number;
  /** ISO-8601 acceptance time. Compared with `enabledAt` when both are present. */
  acceptedAt: string;
};

export type SmsOptIn = {
  optedIn: boolean;
  recordedAt: string | null;
};

export type SmsStopState = "clear" | "suppressed" | "unknown";

export type PrepareExternalWebhookNotificationInput = {
  event: ExternalWebhookAcceptance;
  channel: ExternalWebhookNotificationChannel;
  /** Email mailbox or SMS E.164. Not a lead field. */
  recipient: string;
  /**
   * Email only. This is `ClientDeliveryNotificationPreference.enabled`.
   * It does not opt the client into SMS.
   */
  preferenceEnabled: boolean;
  /** Email only. True when the admin verification timestamp is present. */
  recipientVerified: boolean;
  /** Email preference off-to-on time. SMS uses `sms.optIn.recordedAt` instead. */
  enabledAt: string | null;
  templateId: ExternalWebhookTemplateId;
  sms?: {
    optIn: SmsOptIn;
    stopState: SmsStopState;
  };
};

export type NotificationSkipReason =
  | "sms_disabled"
  | "email_not_configured"
  | "not_accepted"
  | "invalid_event"
  | "invalid_recipient"
  | "not_opted_in"
  | "recipient_not_verified"
  | "before_enabled_at"
  | "eligibility_unknown"
  | "stop_suppressed"
  | "stop_unknown"
  | "invalid_e164"
  | "invalid_twilio_config"
  | "template_rejected"
  | "key_too_long";

export type PreparedEmail = {
  action: "send";
  channel: "email";
  provider: typeof EXTERNAL_WEBHOOK_EMAIL_PROVIDER;
  idempotencyKey: string;
  request: {
    to: string;
    subject: string;
    text: string;
    idempotencyKey: string;
  };
};

export type PreparedSms = {
  action: "send";
  channel: "sms";
  provider: "twilio";
  idempotencyKey: string;
  request: {
    messagingServiceSid: string;
    to: string;
    body: string;
    from: string | null;
  };
};

export type PrepareResult =
  | PreparedEmail
  | PreparedSms
  | { action: "skip"; channel: ExternalWebhookNotificationChannel; reason: NotificationSkipReason };

export function renderExternalWebhookSms(templateId: ExternalWebhookTemplateId): string | null {
  const body = EXTERNAL_WEBHOOK_SMS_TEMPLATES[templateId];
  if (!smsTemplateIsSafe(body)) return null;
  return body;
}

export function smsTemplateIsSafe(body: string): boolean {
  if (!body || body.length > 160) return false;
  if (body.includes("{") || body.includes("}") || body.includes("@")) return false;
  if (/\+\d{8,}/.test(body)) return false;
  if (!body.includes("Reply STOP to opt out.")) return false;
  return /^[\n\r\t\x20-\x7E]+$/.test(body);
}

/**
 * Idempotency grain is one accepted webhook event, one channel, and one
 * recipient. It is not the existing `client_lead:{client}:{lead}` key.
 * `attemptId` and `destinationId` are required evidence and are not part of
 * the key. A key longer than 256 characters is rejected rather than truncated.
 */
export function externalWebhookNotificationIdempotencyKey(input: {
  acceptanceId: string;
  channel: ExternalWebhookNotificationChannel;
  recipient: string;
}): { ok: true; idempotencyKey: string } | { ok: false; reason: "invalid_event" | "invalid_recipient" | "key_too_long" } {
  if (!IDENTITY.test(input.acceptanceId)) return { ok: false, reason: "invalid_event" };
  const recipient = normalizeChannelRecipient(input.channel, input.recipient);
  if (!recipient) return { ok: false, reason: "invalid_recipient" };
  const idempotencyKey = `external_webhook:${input.acceptanceId}:${input.channel}:${recipient}`;
  if (idempotencyKey.length > EXTERNAL_WEBHOOK_IDEMPOTENCY_KEY_MAX) {
    return { ok: false, reason: "key_too_long" };
  }
  return { ok: true, idempotencyKey };
}

export function normalizeExternalWebhookEmail(value: string): string | null {
  const email = value.trim().toLowerCase();
  if (!RECIPIENT_EMAIL.test(email)) return null;
  if (email.includes(",") || email.includes(";") || email.includes("<") || email.includes(">")) return null;
  return email;
}

export function prepareExternalWebhookNotification(
  input: PrepareExternalWebhookNotificationInput,
  deps: {
    smsEnabled?: boolean;
    emailConfigured?: boolean;
    twilioConfig?: ReturnType<typeof readTwilioMessagingConfig>;
    env?: NodeJS.ProcessEnv;
  } = {}
): PrepareResult {
  const env = deps.env ?? process.env;
  if (input.channel === "sms" && !(deps.smsEnabled ?? isSmsNotificationsEnabled(env))) {
    return { action: "skip", channel: "sms", reason: "sms_disabled" };
  }

  const event = validateAcceptance(input.event);
  if (!event.ok) return { action: "skip", channel: input.channel, reason: event.reason };

  const recipient = normalizeChannelRecipient(input.channel, input.recipient);
  if (!recipient) {
    return {
      action: "skip",
      channel: input.channel,
      reason: input.channel === "sms" ? "invalid_e164" : "invalid_recipient",
    };
  }

  const key = externalWebhookNotificationIdempotencyKey({
    acceptanceId: event.acceptance.acceptanceId,
    channel: input.channel,
    recipient,
  });
  if (!key.ok) return { action: "skip", channel: input.channel, reason: key.reason };

  if (input.channel === "email") {
    const eligibility = emailEligibility(input, event.acceptance.acceptedAt);
    if (eligibility) return { action: "skip", channel: "email", reason: eligibility };
    if (!(deps.emailConfigured ?? isTransactionalEmailConfigured())) {
      return { action: "skip", channel: "email", reason: "email_not_configured" };
    }
    if (!input.recipientVerified) return { action: "skip", channel: "email", reason: "recipient_not_verified" };
    const template = EXTERNAL_WEBHOOK_EMAIL_TEMPLATES[input.templateId];
    if (!template || template.text.includes("{") || template.subject.includes("@")) {
      return { action: "skip", channel: "email", reason: "template_rejected" };
    }
    return {
      action: "send",
      channel: "email",
      provider: EXTERNAL_WEBHOOK_EMAIL_PROVIDER,
      idempotencyKey: key.idempotencyKey,
      request: {
        to: recipient,
        subject: template.subject,
        text: template.text,
        idempotencyKey: key.idempotencyKey,
      },
    };
  }

  const smsGate = smsPolicy(input, recipient, event.acceptance.acceptedAt);
  if (smsGate) return { action: "skip", channel: "sms", reason: smsGate };
  const body = renderExternalWebhookSms(input.templateId);
  if (!body) return { action: "skip", channel: "sms", reason: "template_rejected" };
  const config = deps.twilioConfig ?? readTwilioMessagingConfig(env);
  if (!config.ok) return { action: "skip", channel: "sms", reason: "invalid_twilio_config" };
  return {
    action: "send",
    channel: "sms",
    provider: "twilio",
    idempotencyKey: key.idempotencyKey,
    request: {
      messagingServiceSid: config.config.messagingServiceSid,
      to: recipient,
      body,
      from: config.config.from,
    },
  };
}

export type DeliverSmsResult =
  | (TwilioPostResult & { idempotencyKey: string })
  | { ok: false; skipped: true; reason: NotificationSkipReason; providerMessageId: null };

/**
 * Call Twilio only for a prepared send while the SMS flag is on.
 * A skip plan, or a send plan while the flag is off, does not touch `client`.
 */
export async function deliverPreparedSms(
  plan: PrepareResult,
  client: TwilioMessageClient,
  smsEnabled: boolean
): Promise<DeliverSmsResult> {
  if (!smsEnabled || plan.action !== "send" || plan.channel !== "sms") {
    const reason = plan.action === "skip" ? plan.reason : "sms_disabled";
    return { ok: false, skipped: true, reason, providerMessageId: null };
  }
  const posted = await client.postMessage(plan.request);
  return { ...posted, idempotencyKey: plan.idempotencyKey };
}

export function twilioClientFromFetch(
  config: { accountSid: string; authToken: string },
  fetchImpl: typeof fetch
): TwilioMessageClient {
  return createTwilioMessageClient(config, fetchImpl);
}

function validateAcceptance(
  event: ExternalWebhookAcceptance
): { ok: true; acceptance: ExternalWebhookAcceptance } | { ok: false; reason: "not_accepted" | "invalid_event" | "eligibility_unknown" } {
  if (!Number.isInteger(event.httpStatus)) return { ok: false, reason: "invalid_event" };
  if (event.httpStatus < 200 || event.httpStatus > 299) return { ok: false, reason: "not_accepted" };
  const ids = [event.acceptanceId, event.clientAccountId, event.sourceLeadEventId, event.destinationId, event.attemptId];
  if (ids.some((id) => !IDENTITY.test(id))) return { ok: false, reason: "invalid_event" };
  if (Number.isNaN(Date.parse(event.acceptedAt))) return { ok: false, reason: "eligibility_unknown" };
  return { ok: true, acceptance: event };
}

function emailEligibility(
  input: PrepareExternalWebhookNotificationInput,
  acceptedAtIso: string
): NotificationSkipReason | null {
  if (!input.preferenceEnabled) return "not_opted_in";
  return clockReason(input.enabledAt, acceptedAtIso);
}

function smsPolicy(
  input: PrepareExternalWebhookNotificationInput,
  recipient: string,
  acceptedAtIso: string
): NotificationSkipReason | null {
  if (!E164.test(recipient)) return "invalid_e164";
  const sms = input.sms;
  if (!sms?.optIn.optedIn || !sms.optIn.recordedAt || Number.isNaN(Date.parse(sms.optIn.recordedAt))) {
    return "not_opted_in";
  }
  if (sms.stopState === "suppressed") return "stop_suppressed";
  if (sms.stopState !== "clear") return "stop_unknown";
  return clockReason(sms.optIn.recordedAt, acceptedAtIso);
}

function clockReason(enabledAtIso: string | null, acceptedAtIso: string): NotificationSkipReason | null {
  if (enabledAtIso == null) return "eligibility_unknown";
  const enabledAt = new Date(enabledAtIso);
  const acceptedAt = new Date(acceptedAtIso);
  if (Number.isNaN(enabledAt.getTime()) || Number.isNaN(acceptedAt.getTime())) return "eligibility_unknown";
  if (
    !isSourceLeadEligibleForClientNotification({
      enabled: true,
      enabledAt,
      completedAt: acceptedAt,
    })
  ) {
    return "before_enabled_at";
  }
  return null;
}

function normalizeChannelRecipient(channel: ExternalWebhookNotificationChannel, recipient: string): string | null {
  if (channel === "email") return normalizeExternalWebhookEmail(recipient);
  const phone = recipient.trim();
  return E164.test(phone) ? phone : null;
}

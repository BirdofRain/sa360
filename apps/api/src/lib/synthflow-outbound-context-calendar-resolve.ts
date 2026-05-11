import type { InboundContactIndex } from "@prisma/client";
import { extractRoutingCalendarFromLifecyclePayload } from "./lifecycle-routing-calendar.js";
import { resolveOutboundCalendarEntry } from "./synthflow-outbound-calendar-env.js";
import { findLatestLifecyclePayloadJsonForContact } from "../repositories/lifecycle-event.repository.js";
import { findLatestLifecycleWebhookBodyForCalendar } from "../repositories/webhook-request-log-calendar.repository.js";

export type OutboundContextCalendarResolution = {
  schedulingCalendarId: string;
  schedulingCalendarLink: string;
  assignedAgentCalendarId: string;
  assignedAgentCalendarLink: string;
  /**
   * `routing` = resolved from latest lifecycle `payloadJson.routing` (GHL-stamped contact fields).
   * `webhook_request` = same routing fields from latest qualifying `WebhookRequestLog.requestBodyRedacted`.
   * Env map follows both.
   */
  calendarSource: "routing" | "webhook_request" | "agent" | "client_default" | "none";
  calendarIdPresent: boolean;
  newBookingCalendarReady: boolean;
  routingCalendarComplete: boolean;
};

export type ResolveOutboundContextCalendarOptions = {
  /** When set, skips DB read (tests or advanced callers). Otherwise loads latest event by `contactIdGhl`. */
  lifecyclePayload?: unknown;
  /**
   * When set, skips DB read for webhook fallback. Otherwise loads latest qualifying lifecycle webhook log
   * for the contact + client when both IDs are present on `row`.
   */
  webhookRequestBody?: unknown;
};

/**
 * Priority: lifecycle `routing.*` → qualifying lifecycle webhook `requestBodyRedacted.routing.*` →
 * SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON (agent → client default).
 * InboundContactIndex has no calendar columns; routing calendar comes from LifecycleEvent.payloadJson or webhook log body.
 */
export async function resolveOutboundContextCalendar(
  row: InboundContactIndex | null,
  options?: ResolveOutboundContextCalendarOptions
): Promise<OutboundContextCalendarResolution> {
  let lifecyclePayload: unknown | undefined = options?.lifecyclePayload;
  if (lifecyclePayload === undefined && row?.contactIdGhl?.trim()) {
    lifecyclePayload = await findLatestLifecyclePayloadJsonForContact({
      contactIdGhl: row.contactIdGhl,
      clientAccountId: row.clientAccountId,
    });
  }

  const rc = extractRoutingCalendarFromLifecyclePayload(lifecyclePayload);
  const routingHasId = Boolean(rc.calendarId);
  const routingHasLink = Boolean(rc.calendarLink);

  if (routingHasId && routingHasLink) {
    return {
      schedulingCalendarId: rc.calendarId,
      schedulingCalendarLink: rc.calendarLink,
      assignedAgentCalendarId: "",
      assignedAgentCalendarLink: "",
      calendarSource: "routing",
      calendarIdPresent: true,
      newBookingCalendarReady: true,
      routingCalendarComplete: true,
    };
  }

  if (routingHasId && !routingHasLink) {
    return {
      schedulingCalendarId: rc.calendarId,
      schedulingCalendarLink: "",
      assignedAgentCalendarId: "",
      assignedAgentCalendarLink: "",
      calendarSource: "routing",
      calendarIdPresent: true,
      newBookingCalendarReady: false,
      routingCalendarComplete: false,
    };
  }

  let webhookPayload: unknown | undefined = options?.webhookRequestBody;
  const cid = row?.contactIdGhl?.trim() ?? "";
  const caWebhook = row?.clientAccountId?.trim() ?? "";
  if (webhookPayload === undefined && cid && caWebhook) {
    webhookPayload = await findLatestLifecycleWebhookBodyForCalendar({
      contactIdGhl: cid,
      clientAccountId: caWebhook,
    });
  }

  const rcw = extractRoutingCalendarFromLifecyclePayload(webhookPayload);
  const whHasId = Boolean(rcw.calendarId);
  const whHasLink = Boolean(rcw.calendarLink);

  if (whHasId && whHasLink) {
    return {
      schedulingCalendarId: rcw.calendarId,
      schedulingCalendarLink: rcw.calendarLink,
      assignedAgentCalendarId: "",
      assignedAgentCalendarLink: "",
      calendarSource: "webhook_request",
      calendarIdPresent: true,
      newBookingCalendarReady: true,
      routingCalendarComplete: true,
    };
  }

  if (whHasId && !whHasLink) {
    return {
      schedulingCalendarId: rcw.calendarId,
      schedulingCalendarLink: "",
      assignedAgentCalendarId: "",
      assignedAgentCalendarLink: "",
      calendarSource: "webhook_request",
      calendarIdPresent: true,
      newBookingCalendarReady: false,
      routingCalendarComplete: false,
    };
  }

  const clientAccountId = row?.clientAccountId?.trim() ?? "";
  const cal = resolveOutboundCalendarEntry({
    clientAccountId,
    assignedAgentId: row?.assignedAgentId,
  });
  const id = cal.entry?.calendarId ?? "";
  const link = cal.entry?.calendarLink ?? "";
  const hasId = Boolean(id);
  const hasLink = Boolean(link);
  /** Env map: calendar id alone is sufficient (existing behavior). */
  const newBookingCalendarReady = hasId;

  return {
    schedulingCalendarId: id,
    schedulingCalendarLink: link,
    assignedAgentCalendarId: cal.source === "agent" ? id : "",
    assignedAgentCalendarLink: cal.source === "agent" ? link : "",
    calendarSource: cal.source,
    calendarIdPresent: hasId,
    newBookingCalendarReady,
    routingCalendarComplete: false,
  };
}

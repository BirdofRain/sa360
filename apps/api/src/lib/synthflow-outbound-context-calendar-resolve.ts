import type { InboundContactIndex } from "@prisma/client";
import { extractRoutingCalendarFromLifecyclePayload } from "./lifecycle-routing-calendar.js";
import { resolveOutboundCalendarEntry } from "./synthflow-outbound-calendar-env.js";
import { findLatestLifecyclePayloadJsonForContact } from "../repositories/lifecycle-event.repository.js";

export type OutboundContextCalendarResolution = {
  schedulingCalendarId: string;
  schedulingCalendarLink: string;
  assignedAgentCalendarId: string;
  assignedAgentCalendarLink: string;
  calendarSource: "routing" | "agent" | "client_default" | "none";
  calendarIdPresent: boolean;
  newBookingCalendarReady: boolean;
  routingCalendarComplete: boolean;
};

/**
 * Priority: latest lifecycle `routing` calendar (GHL-stamped) → env agent map → env client default.
 */
export async function resolveOutboundContextCalendar(
  row: InboundContactIndex | null
): Promise<OutboundContextCalendarResolution> {
  const none: OutboundContextCalendarResolution = {
    schedulingCalendarId: "",
    schedulingCalendarLink: "",
    assignedAgentCalendarId: "",
    assignedAgentCalendarLink: "",
    calendarSource: "none",
    calendarIdPresent: false,
    newBookingCalendarReady: false,
    routingCalendarComplete: false,
  };

  if (row?.contactIdGhl?.trim()) {
    const payload = await findLatestLifecyclePayloadJsonForContact({
      contactIdGhl: row.contactIdGhl,
      clientAccountId: row.clientAccountId,
    });
    const rc = extractRoutingCalendarFromLifecyclePayload(payload);
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

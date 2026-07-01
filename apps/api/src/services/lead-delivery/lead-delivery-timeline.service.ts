import type { SourceLeadEvent } from "@prisma/client";
import type { LeadTimelineResponse } from "../lead-timeline.types.js";
import type { SourceEnrichmentMetadata } from "../source-intake/source-enrichment.types.js";
import type {
  LeadDeliveryTimelineMilestone,
  LeadDeliveryTimelineMilestoneName,
} from "./lead-delivery.types.js";

const EVENT_MILESTONE_MAP: Record<string, LeadDeliveryTimelineMilestoneName> = {
  lead_created: "lead_created",
  first_response: "first_touch_sent",
  contact_replied: "contact_replied",
  appointment_set: "appointment_set",
  appointment_showed: "appointment_showed",
  sold: "sold",
  policy_issued: "sold",
};

const MILESTONE_ORDER: LeadDeliveryTimelineMilestoneName[] = [
  "source_lead_received",
  "lead_created",
  "lead_matched",
  "lead_routed",
  "lead_delivery_started",
  "lead_delivered",
  "client_contact_created",
  "client_workflow_started",
  "first_touch_sent",
  "contact_replied",
  "appointment_set",
  "appointment_showed",
  "sold",
];

function pushMilestone(
  entries: LeadDeliveryTimelineMilestone[],
  milestone: LeadDeliveryTimelineMilestoneName,
  at: string | undefined,
  status: LeadDeliveryTimelineMilestone["status"],
  detail?: string
) {
  if (!at && status !== "failed") return;
  if (entries.some((e) => e.milestone === milestone)) return;
  entries.push({ milestone, at, status, detail });
}

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function contactIdFromDeliveryResult(deliveryResultJson: unknown): string | null {
  const root = asRecord(deliveryResultJson);
  if (!root) return null;
  const direct = root.contactIdGhl ?? root.contact_id_ghl;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const contact = asRecord(root.contact);
  const nested = contact?.contact_id_ghl ?? contact?.id;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return null;
}

export function buildLeadDeliveryTimeline(input: {
  sourceLead: SourceLeadEvent;
  timeline: LeadTimelineResponse | null;
  contactIdGhl?: string | null;
}): LeadDeliveryTimelineMilestone[] {
  const entries: LeadDeliveryTimelineMilestone[] = [];
  const { sourceLead, timeline } = input;

  if (sourceLead.receivedAt) {
    pushMilestone(entries, "source_lead_received", sourceLead.receivedAt.toISOString(), "complete");
  }
  if (sourceLead.normalizedAt) {
    pushMilestone(entries, "lead_created", sourceLead.normalizedAt.toISOString(), "complete");
  }
  if (sourceLead.routingRuleIdResolved || sourceLead.clientAccountIdResolved) {
    pushMilestone(
      entries,
      "lead_matched",
      (sourceLead.routedAt ?? sourceLead.normalizedAt)?.toISOString(),
      "complete"
    );
  }
  if (sourceLead.routedAt) {
    pushMilestone(entries, "lead_routed", sourceLead.routedAt.toISOString(), "complete");
  }
  if (sourceLead.approvedAt) {
    pushMilestone(entries, "lead_delivery_started", sourceLead.approvedAt.toISOString(), "complete");
  }
  if (sourceLead.deliveredAt) {
    pushMilestone(entries, "lead_delivered", sourceLead.deliveredAt.toISOString(), "complete");
  }
  if (sourceLead.status === "delivery_failed" && sourceLead.errorSummary) {
    pushMilestone(
      entries,
      "lead_delivery_started",
      (sourceLead.approvedAt ?? sourceLead.routedAt)?.toISOString(),
      "failed",
      sourceLead.errorSummary
    );
  }

  if (timeline) {
    for (const event of timeline.timeline) {
      const name = event.eventNameInternal?.trim();
      if (!name) continue;
      const milestone = EVENT_MILESTONE_MAP[name];
      if (!milestone) continue;
      const status: LeadDeliveryTimelineMilestone["status"] =
        event.processingStatus === "failed" || event.validity === "invalid" ? "failed" : "complete";
      pushMilestone(
        entries,
        milestone,
        event.receivedAt,
        status,
        event.summary ?? event.errorSummary ?? undefined
      );
    }

    const contactId = timeline.identity.contactIdGhl ?? input.contactIdGhl;
    if (contactId) {
      pushMilestone(
        entries,
        "client_contact_created",
        timeline.currentState.lastSeenAt ?? undefined,
        "complete"
      );
    }
    if (timeline.currentState.routingStatus === "workflow_started") {
      pushMilestone(
        entries,
        "client_workflow_started",
        timeline.currentState.lastSeenAt ?? undefined,
        "complete"
      );
    }
    if (timeline.currentState.appointmentStatus === "set") {
      pushMilestone(
        entries,
        "appointment_set",
        timeline.currentState.lastSeenAt ?? undefined,
        "complete"
      );
    }
    if (timeline.currentState.appointmentStatus === "showed") {
      pushMilestone(
        entries,
        "appointment_showed",
        timeline.currentState.lastSeenAt ?? undefined,
        "complete"
      );
    }
    if (
      timeline.currentState.policyStatus === "sold" ||
      timeline.currentState.policyStatus === "issued"
    ) {
      pushMilestone(entries, "sold", timeline.currentState.lastSeenAt ?? undefined, "complete");
    }
  } else {
    const contactId = input.contactIdGhl ?? contactIdFromDeliveryResult(sourceLead.deliveryResultJson);
    if (contactId && sourceLead.deliveredAt) {
      pushMilestone(
        entries,
        "client_contact_created",
        sourceLead.deliveredAt.toISOString(),
        "complete"
      );
    }
  }

  const byMilestone = new Map(entries.map((e) => [e.milestone, e]));
  return MILESTONE_ORDER.filter((m) => byMilestone.has(m)).map((m) => byMilestone.get(m)!);
}

export function safeSourceAttributes(
  enrichment: SourceEnrichmentMetadata | null
): Record<string, string | number | boolean | null> {
  if (!enrichment?.sourceAttributes) return {};
  const out: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(enrichment.sourceAttributes)) {
    if (typeof value === "string" || typeof value === "number" || typeof value === "boolean" || value === null) {
      out[key] = value;
    }
  }
  return out;
}

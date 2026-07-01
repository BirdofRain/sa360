import type { AdminLeadTimelineEntry, AdminLeadTimelineResponse } from "@/lib/admin-api/types";
import type { SourceLeadDetail } from "@/lib/source-intake/types";

import type { LeadDeliveryMilestone, LeadDeliveryTimelineEntry, MilestoneStatus } from "../types";

const EVENT_MILESTONE_MAP: Record<string, LeadDeliveryMilestone> = {
  lead_created: "lead_created",
  first_response: "first_touch_sent",
  contact_replied: "contact_replied",
  appointment_set: "appointment_set",
  appointment_showed: "appointment_showed",
  sold: "sold",
  policy_issued: "sold",
};

function pushMilestone(
  entries: LeadDeliveryTimelineEntry[],
  milestone: LeadDeliveryMilestone,
  at: string | undefined,
  status: MilestoneStatus,
  detail?: string
) {
  if (!at && status !== "failed") return;
  if (entries.some((e) => e.milestone === milestone)) return;
  entries.push({ milestone, at, status, detail });
}

function milestoneFromEvents(
  timeline: AdminLeadTimelineEntry[]
): LeadDeliveryTimelineEntry[] {
  const entries: LeadDeliveryTimelineEntry[] = [];
  for (const event of timeline) {
    const name = event.eventNameInternal?.trim();
    if (!name) continue;
    const milestone = EVENT_MILESTONE_MAP[name];
    if (!milestone) continue;
    const status: MilestoneStatus =
      event.processingStatus === "failed" || event.validity === "invalid"
        ? "failed"
        : "complete";
    pushMilestone(
      entries,
      milestone,
      event.receivedAt,
      status,
      event.summary ?? event.errorSummary ?? undefined
    );
  }
  return entries;
}

export function buildTimelineFromSourceLeadAndTimeline(
  source: SourceLeadDetail | null,
  timeline: AdminLeadTimelineResponse | null
): LeadDeliveryTimelineEntry[] {
  const entries: LeadDeliveryTimelineEntry[] = [];

  if (source?.receivedAt) {
    pushMilestone(entries, "source_lead_received", source.receivedAt, "complete");
  }
  if (source?.normalizedAt) {
    pushMilestone(entries, "lead_created", source.normalizedAt, "complete");
  }
  if (source?.matched) {
    pushMilestone(entries, "lead_matched", source.routedAt ?? source.normalizedAt ?? undefined, "complete");
  }
  if (source?.routedAt) {
    pushMilestone(entries, "lead_routed", source.routedAt, "complete");
  }
  if (source?.approvedAt) {
    pushMilestone(entries, "lead_delivery_started", source.approvedAt, "complete");
  }
  if (source?.deliveredAt) {
    pushMilestone(entries, "lead_delivered", source.deliveredAt, "complete");
  }
  if (source?.errorSummary) {
    const failed: MilestoneStatus = source.status === "failed" ? "failed" : "complete";
    if (failed === "failed") {
      pushMilestone(entries, "lead_delivery_started", source.approvedAt ?? undefined, "failed", source.errorSummary);
    }
  }

  if (timeline) {
    entries.push(...milestoneFromEvents(timeline.timeline));

    if (timeline.identity.contactIdGhl) {
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
    if (timeline.currentState.policyStatus === "sold" || timeline.currentState.policyStatus === "issued") {
      pushMilestone(
        entries,
        "sold",
        timeline.currentState.lastSeenAt ?? undefined,
        "complete"
      );
    }
  }

  const order: LeadDeliveryMilestone[] = [
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

  const byMilestone = new Map(entries.map((e) => [e.milestone, e]));
  return order.filter((m) => byMilestone.has(m)).map((m) => byMilestone.get(m)!);
}

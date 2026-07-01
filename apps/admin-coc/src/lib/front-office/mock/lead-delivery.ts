import type {
  LeadDeliveryDetail,
  LeadDeliveryListResponse,
  LeadDeliveryMilestone,
  LeadDeliveryTimelineEntry,
  MilestoneStatus,
} from "../types";

const ALL_MILESTONES: LeadDeliveryMilestone[] = [
  "source_lead_received",
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

function buildTimeline(
  completedCount: number,
  failedAt?: LeadDeliveryMilestone
): LeadDeliveryTimelineEntry[] {
  return ALL_MILESTONES.map((milestone, index) => {
    let status: MilestoneStatus = "pending";
    if (failedAt === milestone) status = "failed";
    else if (index < completedCount) status = "complete";
    else if (index === completedCount && failedAt) status = "skipped";

    const base = new Date(Date.now() - (ALL_MILESTONES.length - index) * 120000);
    return {
      milestone,
      status,
      at: status === "complete" || status === "failed" ? base.toISOString() : undefined,
      detail:
        status === "failed"
          ? "GHL contact create returned 429 — rate limited"
          : undefined,
    };
  });
}

const MOCK_ROWS: LeadDeliveryDetail[] = [
  {
    leadUid: "FO-2026-00821",
    receivedAt: new Date(Date.now() - 8 * 60000).toISOString(),
    leadName: "Maria Gonzalez",
    phoneMasked: "(512) ***-4821",
    source: "Vendor CSV · Fresh",
    campaign: "Fresh Insurance TX",
    matchedClient: "Summit Insurance Group",
    deliveryStatus: "delivered",
    ghlContact: "created",
    workflowStarted: true,
    firstTouchStatus: "replied",
    appointmentStatus: "set",
    soldStatus: "none",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00820",
    receivedAt: new Date(Date.now() - 22 * 60000).toISOString(),
    leadName: "James Chen",
    phoneMasked: "(480) ***-7734",
    source: "Webhook · Meta",
    campaign: "Q2 Aged Solar",
    matchedClient: "Pacific Solar Co",
    deliveryStatus: "in_progress",
    ghlContact: "n/a",
    workflowStarted: false,
    firstTouchStatus: "pending",
    appointmentStatus: "none",
    soldStatus: "none",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00819",
    receivedAt: new Date(Date.now() - 35 * 60000).toISOString(),
    leadName: "Robert Williams",
    phoneMasked: "(602) ***-1192",
    source: "Bulk import",
    campaign: "HVAC Summer Push",
    matchedClient: "Desert HVAC Pros",
    deliveryStatus: "failed",
    ghlContact: "failed",
    workflowStarted: false,
    firstTouchStatus: "failed",
    appointmentStatus: "none",
    soldStatus: "none",
    error: "GHL contact create failed — location token expired",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00818",
    receivedAt: new Date(Date.now() - 51 * 60000).toISOString(),
    leadName: "Sarah Kim",
    phoneMasked: "(713) ***-3390",
    source: "Webhook · GHL",
    campaign: "Fresh Insurance TX",
    matchedClient: "Summit Insurance Group",
    deliveryStatus: "delivered",
    ghlContact: "existing",
    workflowStarted: true,
    firstTouchStatus: "sent",
    appointmentStatus: "showed",
    soldStatus: "quoted",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00817",
    receivedAt: new Date(Date.now() - 78 * 60000).toISOString(),
    leadName: "David Martinez",
    phoneMasked: "(520) ***-8841",
    source: "Vendor CSV · Aged",
    campaign: "Q2 Aged Solar",
    matchedClient: "Pacific Solar Co",
    deliveryStatus: "delivered",
    ghlContact: "created",
    workflowStarted: true,
    firstTouchStatus: "replied",
    appointmentStatus: "showed",
    soldStatus: "sold",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00816",
    receivedAt: new Date(Date.now() - 95 * 60000).toISOString(),
    leadName: "Emily Johnson",
    phoneMasked: "(505) ***-2210",
    source: "Webhook · Meta",
    campaign: "Fresh Insurance TX",
    matchedClient: "Summit Insurance Group",
    deliveryStatus: "pending",
    ghlContact: "n/a",
    workflowStarted: false,
    firstTouchStatus: "pending",
    appointmentStatus: "none",
    soldStatus: "none",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00815",
    receivedAt: new Date(Date.now() - 120 * 60000).toISOString(),
    leadName: "Michael Brown",
    phoneMasked: "(623) ***-5567",
    source: "Vendor CSV · Fresh",
    campaign: "HVAC Summer Push",
    matchedClient: "Desert HVAC Pros",
    deliveryStatus: "skipped",
    ghlContact: "n/a",
    workflowStarted: false,
    firstTouchStatus: "pending",
    appointmentStatus: "none",
    soldStatus: "none",
    error: "No matching routing rule — manual review required",
    timeline: [],
  },
  {
    leadUid: "FO-2026-00814",
    receivedAt: new Date(Date.now() - 145 * 60000).toISOString(),
    leadName: "Lisa Anderson",
    phoneMasked: "(915) ***-9903",
    source: "Webhook · GHL",
    campaign: "Q2 Aged Solar",
    matchedClient: "Pacific Solar Co",
    deliveryStatus: "delivered",
    ghlContact: "created",
    workflowStarted: true,
    firstTouchStatus: "sent",
    appointmentStatus: "no_show",
    soldStatus: "none",
    timeline: [],
  },
];

const TIMELINE_MAP: Record<string, LeadDeliveryTimelineEntry[]> = {
  "FO-2026-00821": buildTimeline(9),
  "FO-2026-00820": buildTimeline(3),
  "FO-2026-00819": buildTimeline(4, "client_contact_created"),
  "FO-2026-00818": buildTimeline(11),
  "FO-2026-00817": buildTimeline(12),
  "FO-2026-00816": buildTimeline(2),
  "FO-2026-00815": buildTimeline(2),
  "FO-2026-00814": buildTimeline(10),
};

export function getMockLeadDeliveryList(
  role: "admin" | "client" | "agent" = "admin"
): LeadDeliveryListResponse {
  let rows = MOCK_ROWS;
  if (role === "client") {
    rows = MOCK_ROWS.filter((r) => r.matchedClient === "Summit Insurance Group");
  }
  return {
    rows: rows.map((row) => {
      const { timeline: _timeline, ...rest } = row;
      return rest;
    }),
    dataSource: "mock",
  };
}

export function getMockLeadDeliveryDetail(
  leadUid: string
): LeadDeliveryDetail | null {
  const row = MOCK_ROWS.find((r) => r.leadUid === leadUid);
  if (!row) return null;
  const { timeline, ...rest } = row;
  void timeline;
  return {
    ...rest,
    timeline: TIMELINE_MAP[leadUid] ?? buildTimeline(1),
  };
}

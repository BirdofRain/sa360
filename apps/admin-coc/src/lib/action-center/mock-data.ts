import type { ActionCenterDashboardResponse } from "./types";

function hoursAgo(h: number): string {
  return new Date(Date.now() - h * 3600000).toISOString();
}

function minutesFromNow(m: number): string {
  return new Date(Date.now() + m * 60000).toISOString();
}

/**
 * Read-only mock dashboard. Replace with `fetchActionCenterDashboard()` when API ships.
 */
export function getMockActionCenterDashboard(params: {
  clientAccountId: string;
  locationId?: string;
  agentDisplayName?: string;
}): ActionCenterDashboardResponse {
  const locationId = params.locationId?.trim() || "loc_demo_ghl_001";
  const agent = params.agentDisplayName?.trim() || "Jordan Rivera";

  return {
    ok: true,
    generatedAt: new Date().toISOString(),
    clientAccountId: params.clientAccountId,
    locationId,
    agentDisplayName: agent,
    ghlConnection: {
      status: "connected",
      locationId,
      locationName: "Rivera Insurance — Main",
      lastSyncAt: hoursAgo(0.25),
      message: "CRM sync healthy. Webhooks received in the last 15 minutes.",
    },
    kpis: {
      aiAppointmentsToday: 4,
      hotActionsWaiting: 7,
      callsLoggedToday: 11,
      revenueSignalsToday: 3,
    },
    priorityCalls: [
      {
        rank: 1,
        priorityScore: 98,
        contactIdGhl: "ghl_c_88421",
        leadUid: "lead_9f2a",
        displayName: "Maria Santos",
        phoneE164: "+15551234001",
        reason: "AI booked appointment — confirm coverage window before 11:00 AM",
        reasonCode: "ai_appointment_ready",
        dueBy: minutesFromNow(45),
        estimatedPremium: 4200,
        lifecycleStage: "APPOINTMENT_SET",
        lastTouchAt: hoursAgo(0.5),
      },
      {
        rank: 2,
        priorityScore: 91,
        contactIdGhl: "ghl_c_77102",
        displayName: "Robert Chen",
        phoneE164: "+15559876543",
        reason: "Hot inbound — voice AI flagged high intent on term quote",
        reasonCode: "hot_lead",
        dueBy: minutesFromNow(90),
        estimatedPremium: 6800,
        lifecycleStage: "AI_ENGAGED",
        lastTouchAt: hoursAgo(1),
      },
      {
        rank: 3,
        priorityScore: 86,
        contactIdGhl: "ghl_c_55290",
        leadUid: "lead_3c11",
        displayName: "Patricia Nguyen",
        phoneE164: "+15557654321",
        reason: "Callback due — requested human follow-up after SMS sequence",
        reasonCode: "callback_due",
        dueBy: minutesFromNow(120),
        estimatedPremium: 3100,
        lifecycleStage: "ATTEMPTING_CONTACT",
        lastTouchAt: hoursAgo(18),
      },
      {
        rank: 4,
        priorityScore: 82,
        contactIdGhl: "ghl_c_44108",
        displayName: "James Okonkwo",
        phoneE164: "+15553334444",
        reason: "Revenue signal — policy review completed, ready for close conversation",
        reasonCode: "revenue_signal",
        dueBy: null,
        estimatedPremium: 9500,
        lifecycleStage: "POLICY_REVIEW",
        lastTouchAt: hoursAgo(3),
      },
      {
        rank: 5,
        priorityScore: 74,
        contactIdGhl: "ghl_c_33017",
        displayName: "Linda Martinez",
        phoneE164: "+15552221111",
        reason: "Stale follow-up — no agent touch in 5 days post appointment no-show",
        reasonCode: "stale_follow_up",
        dueBy: null,
        estimatedPremium: 2800,
        lifecycleStage: "NO_SHOW",
        lastTouchAt: hoursAgo(120),
      },
    ],
    activeLeads: [
      {
        contactIdGhl: "ghl_c_88421",
        leadUid: "lead_9f2a",
        displayName: "Maria Santos",
        lifecycleStage: "APPOINTMENT_SET",
        appointmentStatus: "Confirmed",
        policyStatus: "Quote sent",
        nextAction: "Confirm appointment & pre-call questionnaire",
        lastActivityAt: hoursAgo(0.5),
        ownerName: agent,
      },
      {
        contactIdGhl: "ghl_c_77102",
        displayName: "Robert Chen",
        lifecycleStage: "AI_ENGAGED",
        appointmentStatus: "Pending",
        policyStatus: "Discovery",
        nextAction: "First human call — review AI transcript",
        lastActivityAt: hoursAgo(1),
        ownerName: agent,
      },
      {
        contactIdGhl: "ghl_c_22044",
        leadUid: "lead_88ab",
        displayName: "David Kim",
        lifecycleStage: "HUMAN_ACTIVATION",
        appointmentStatus: null,
        policyStatus: "Application started",
        nextAction: "Complete underwriting questions in GHL",
        lastActivityAt: hoursAgo(2),
        ownerName: "Unassigned",
      },
    ],
    aiActivityFeed: [
      {
        id: "feed_001",
        at: hoursAgo(0.2),
        kind: "appointment",
        title: "Appointment booked via voice AI",
        detail: "Maria Santos — tomorrow 10:30 AM CT",
        contactIdGhl: "ghl_c_88421",
        displayName: "Maria Santos",
      },
      {
        id: "feed_002",
        at: hoursAgo(0.8),
        kind: "voice",
        title: "Inbound Synthflow call completed",
        detail: "Robert Chen — outcome: interested, quote requested",
        contactIdGhl: "ghl_c_77102",
        displayName: "Robert Chen",
      },
      {
        id: "feed_003",
        at: hoursAgo(1.5),
        kind: "routing",
        title: "Lead routed to human queue",
        detail: "Patricia Nguyen — callback requested",
        contactIdGhl: "ghl_c_55290",
        displayName: "Patricia Nguyen",
      },
      {
        id: "feed_004",
        at: hoursAgo(2.2),
        kind: "sms",
        title: "Reminder sequence sent",
        detail: "James Okonkwo — policy review follow-up",
        contactIdGhl: "ghl_c_44108",
        displayName: "James Okonkwo",
      },
      {
        id: "feed_005",
        at: hoursAgo(4),
        kind: "handoff",
        title: "Human activation flagged",
        detail: "David Kim — missing health questionnaire",
        contactIdGhl: "ghl_c_22044",
        displayName: "David Kim",
      },
    ],
  };
}

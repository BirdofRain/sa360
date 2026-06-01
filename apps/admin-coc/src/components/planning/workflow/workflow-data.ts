import type { WorkflowModule } from "./workflow-types";

export const WORKFLOW_MODULES: WorkflowModule[] = [
  {
    id: "M1",
    short: "M1",
    title: "Module 1 — Intake + Attribution Fabric",
    purpose: "Normalize every lead and create the signal spine.",
    moduleStatus: "LIVE",
    tone: {
      container: "border-blue-200 bg-blue-50/40",
      accent: "bg-blue-500",
      eyebrow: "text-blue-700",
    },
    cards: [
      {
        id: "M1A",
        title: "Master Intake / Source Connector",
        status: "LIVE",
        bullets: [
          "Lead enters from Facebook / GHL / form / import",
          "Stamps client, subaccount, lead_uid, niche, campaign metadata",
          "Sends normalized webhook to SA360",
        ],
      },
      {
        id: "M1B",
        title: "Normalize + Enrich",
        status: "LIVE",
        bullets: [
          "Normalize phone, state, timezone",
          "Validate contact identity",
          "Refresh attribution and index data",
        ],
      },
      {
        id: "M1C",
        title: "Signal Dispatch / Event Ledger",
        status: "LIVE",
        bullets: [
          "Store LifecycleEvent",
          "Upsert LeadAttribution and InboundContactIndex",
          "Queue Meta dispatch when eligible",
          "Feed Admin C.O.C. reporting",
        ],
      },
      {
        id: "M1D",
        title: "Attribution Capture",
        status: "LIVE",
        bullets: [
          "Campaign, ad set, and source attribution on intake",
          "Feeds routing registry and client reporting",
        ],
      },
      {
        id: "M1E",
        title: "Campaign Routing Registry",
        status: "LIVE",
        bullets: [
          "CampaignRoutingRule records loaded for dry-run matching",
          "Operator review via Routing Dry Run C.O.C. page",
        ],
      },
    ],
    fieldChips: ["client_account_id", "subaccount_id_ghl", "lead_uid"],
  },

  {
    id: "M2",
    short: "M2",
    title: "Module 2 — Smart Routing + Channel Orchestration",
    purpose: "Match campaigns to clients and decide channel, timing, and follow-up path.",
    moduleStatus: "BUILDING",
    tone: {
      container: "border-violet-200 bg-violet-50/40",
      accent: "bg-violet-500",
      eyebrow: "text-violet-700",
    },
    cards: [
      {
        id: "M2A",
        title: "Routing Rule Match",
        status: "LIVE",
        bullets: [
          "Evaluate CampaignRoutingRule against inbound lead context",
          "Produce match / no-match / review-required outcome",
        ],
      },
      {
        id: "M2B",
        title: "Dry Run Decision",
        status: "LIVE",
        bullets: [
          "Persist RoutingDryRunDecision without live delivery",
          "Visible on internal Routing Dry Run page",
        ],
      },
      {
        id: "M2C",
        title: "Review Required Queue",
        status: "LIVE",
        bullets: [
          "Route ambiguous or missing-config leads to operator review",
          "Blocks shadow delivery until resolved",
        ],
      },
      {
        id: "M2D",
        title: "Campaign-to-Client Mapping",
        status: "LIVE",
        bullets: [
          "Registry maps campaign names to client accounts and destinations",
          "Needs internal onboarding UI for ongoing edits",
        ],
        footnote: "Live in data layer; management UI is next.",
      },
      {
        id: "M2E",
        title: "Client Onboarding Config",
        status: "NEXT",
        bullets: [
          "Client profile, subaccount, routing rules, pipeline IDs, readiness checklist",
          "Priority for Breanna VET FEX pilot",
        ],
      },
      {
        id: "M2F",
        title: "Channel / AI Select",
        status: "BUILDING",
        bullets: [
          "BLUE / GREEN / VOICE channel selection",
          "CloseBot / GHL AI / NONE provider selection",
          "GHL workflow field stamping",
        ],
        fieldChips: ["sa360_channel_mode", "sa360_ai_mode"],
      },
      {
        id: "M2G",
        title: "First Touch / Follow-up Routing",
        status: "BUILDING",
        bullets: [
          "First-touch watcher and daily cadence (DAY_1–DAY_8)",
          "Timing gate and confirm/remind paths",
        ],
        fieldChips: ["sa360_followup_day", "sa360_booking_detected"],
      },
    ],
    branches: [
      { trigger: "No routing match", target: "Review Required", tone: "failure" },
      { trigger: "Match + config OK", target: "M3 Shadow Delivery", tone: "success" },
    ],
    fieldChips: ["sa360_channel_mode", "sa360_routing_status"],
  },

  {
    id: "M3",
    short: "M3",
    title: "Module 3 — Execution + GHL Operations Layer",
    purpose: "Shadow and guarded live delivery into client GHL subaccounts.",
    moduleStatus: "BUILDING",
    tone: {
      container: "border-orange-200 bg-orange-50/40",
      accent: "bg-orange-500",
      eyebrow: "text-orange-700",
    },
    cards: [
      {
        id: "M3A",
        title: "Shadow Delivery Plan",
        status: "LIVE",
        bullets: [
          "LeadDeliveryPlan generated from routing decision",
          "No live GHL writes — operator review only",
        ],
      },
      {
        id: "M3B",
        title: "Delivery Readiness Guard",
        status: "LIVE",
        bullets: [
          "Readiness checklist must pass before simulation or canary",
          "Production adapter disabled by default",
        ],
      },
      {
        id: "M3C",
        title: "Duplicate / Identity Risk Review",
        status: "LIVE",
        bullets: [
          "LeadDuplicateRiskAssessment before any live attempt",
          "Operator sign-off required on elevated risk",
        ],
      },
      {
        id: "M3D",
        title: "GHL Adapter Simulation",
        status: "LIVE",
        bullets: [
          "GhlDeliveryAdapterRun validates payload mapping",
          "No production API writes during simulation",
        ],
      },
      {
        id: "M3E",
        title: "GHL Live Canary Executor",
        status: "DISABLED IN PROD",
        bullets: [
          "GhlLiveDeliveryRun with assertLiveDeliveryAllowed",
          "Manual approval only — code-complete, prod disabled",
          "Zapier/legacy remains active until cutover confirmed",
        ],
        footnote: "GHL_DELIVERY_ADAPTER_MODE stays off in production until explicit cutover.",
      },
      {
        id: "M3F",
        title: "Client GHL Opportunity Pipeline",
        status: "PRIORITY",
        bullets: [
          "Write opportunities and stages in client pipeline",
          "Receive lifecycle signals from stage changes",
        ],
      },
      {
        id: "M3G",
        title: "Workflow / Pipeline ID Configuration",
        status: "PRIORITY",
        bullets: [
          "Per-client destination workflow ID, pipeline ID, stage IDs, assigned user",
          "Blocked on Breanna pilot field collection",
        ],
      },
    ],
    branches: [
      { trigger: "Readiness fail", target: "Operator review", tone: "failure" },
      { trigger: "Canary approved", target: "GHL Live Transport", tone: "next" },
    ],
  },

  {
    id: "M3V",
    short: "M3V",
    title: "Module 3V — Voice + AI Path",
    purpose: "Voice AI execution and appointment sources alongside text routing.",
    moduleStatus: "BUILDING",
    tone: {
      container: "border-teal-200 bg-teal-50/40",
      accent: "bg-teal-500",
      eyebrow: "text-teal-700",
    },
    cards: [
      {
        id: "M3V-A",
        title: "Synthflow Voice Preflight",
        status: "LIVE",
        bullets: [
          "Verify voice toggles and resolve contact context",
          "Log requests for Admin C.O.C.",
        ],
      },
      {
        id: "M3V-B",
        title: "Voice Call + Booking Attempt",
        status: "BUILDING",
        bullets: [
          "Outbound/inbound Synthflow execution",
          "Booking attempt and transcript capture",
        ],
      },
      {
        id: "M3V-C",
        title: "Voice Result Capture + Lifecycle Sync",
        status: "NEXT",
        bullets: [
          "Sync voice outcomes to lifecycle events",
          "Feed portal metrics and Meta when eligible",
        ],
      },
      {
        id: "M3V-D",
        title: "CloseBot Appointment Source",
        status: "LIVE",
        bullets: [
          "AI conversation and booking used in client GHL automations",
          "Appointment signals back into SA360 lifecycle",
        ],
      },
      {
        id: "M3V-E",
        title: "Jasper Vocal Agent Live Transfers",
        status: "EXPLORING",
        bullets: [
          "Potential live transfer path — evaluation only",
          "Not in pilot scope for Bre VET FEX",
        ],
      },
    ],
    branches: [
      { trigger: "Booking confirmed", target: "Lifecycle: appointment_set", tone: "success" },
      { trigger: "Failed / unknown", target: "Review Queue", tone: "failure" },
    ],
  },

  {
    id: "M4",
    short: "M4",
    title: "Module 4 — Client Portal + Embedded Experience",
    purpose: "Client-facing visibility and future GHL-embedded access.",
    moduleStatus: "BETA",
    tone: {
      container: "border-indigo-200 bg-indigo-50/40",
      accent: "bg-indigo-500",
      eyebrow: "text-indigo-700",
    },
    cards: [
      {
        id: "M4A",
        title: "Client Portal Login",
        status: "LIVE",
        bullets: ["/portal/login with session protection", "Separate from internal C.O.C."],
      },
      {
        id: "M4B",
        title: "Client Dashboard Metrics",
        status: "LIVE",
        bullets: [
          "Live scoped metrics from Postgres read models",
          "Wired for pilot client configuration",
        ],
      },
      {
        id: "M4C",
        title: "Client-specific Portal Scoping",
        status: "PRIORITY",
        bullets: [
          "Map portal login to client_account_id (e.g. breanna_kimberling)",
          "Show only that client's data",
        ],
      },
      {
        id: "M4D",
        title: "GHL Custom Menu Link / Embedded Portal",
        status: "NEXT",
        bullets: [
          "Entry point inside GHL for portal and action center",
          "Depends on pilot portal scoping",
        ],
      },
      {
        id: "M4E",
        title: "Daily Action Dashboard / Client Action Center",
        status: "NEXT",
        bullets: [
          "Agent execution console embed (read-only MVP exists at /action-center)",
          "Future client-facing lead actions",
        ],
      },
    ],
  },

  {
    id: "M5",
    short: "M5",
    title: "Module 5 — Client Onboarding + Snapshot Setup",
    purpose: "Internal configuration so delivery and portal can go live per client.",
    moduleStatus: "PRIORITY",
    tone: {
      container: "border-amber-200 bg-amber-50/40",
      accent: "bg-amber-600",
      eyebrow: "text-amber-800",
    },
    cards: [
      {
        id: "M5A",
        title: "Client Profile Setup",
        status: "PRIORITY",
        bullets: ["clientAccountId, niche, product enabled, portal enabled flag"],
      },
      {
        id: "M5B",
        title: "GHL Subaccount Link",
        status: "PRIORITY",
        bullets: ["destinationSubaccountIdGhl and location context"],
      },
      {
        id: "M5C",
        title: "Campaign / Form Mapping",
        status: "PRIORITY",
        bullets: ["Campaign name → routing rule → client account"],
      },
      {
        id: "M5D",
        title: "Delivery Config Wizard",
        status: "PRIORITY",
        bullets: [
          "Workflow ID, pipeline/stage IDs, assigned user ID",
          "Destination workflow for delivery orchestrator",
        ],
      },
      {
        id: "M5E",
        title: "Snapshot Field Verification",
        status: "PRIORITY",
        bullets: [
          "Confirm SA360 snapshot installed",
          "Custom field IDs verified in subaccount",
        ],
      },
      {
        id: "M5F",
        title: "Readiness Checklist",
        status: "PRIORITY",
        bullets: [
          "Delivery readiness gates before simulation or canary",
          "Duplicate risk and legacy comparison sign-off",
        ],
      },
      {
        id: "M5G",
        title: "Test Lead Simulation",
        status: "PRIORITY",
        bullets: [
          "Shadow plan + adapter simulation on test/real leads",
          "Legacy comparison marked before live canary",
        ],
      },
    ],
  },

  {
    id: "M6",
    short: "M6",
    title: "Module 6 — Post-Sale / Retention / Referral",
    purpose: "Lifecycle automations after the sale — beyond beta pilot scope.",
    moduleStatus: "FUTURE",
    tone: {
      container: "border-slate-200 bg-slate-50/60",
      accent: "bg-slate-400",
      eyebrow: "text-slate-700",
    },
    cards: [
      {
        id: "M6A",
        title: "Post-sale follow-up",
        status: "FUTURE",
        bullets: ["Policy delivery touchpoints and check-ins"],
      },
      {
        id: "M6B",
        title: "Referral request flows",
        status: "FUTURE",
        bullets: ["Ask satisfied clients for referrals"],
      },
      {
        id: "M6C",
        title: "Reactivation flows",
        status: "FUTURE",
        bullets: ["Win-back sequences for lapsed leads or clients"],
      },
      {
        id: "M6D",
        title: "Birthday / holiday / client nurture",
        status: "FUTURE",
        bullets: ["Relationship nurture automations"],
      },
      {
        id: "M6E",
        title: "Future client lifecycle automations",
        status: "FUTURE",
        bullets: ["Broader retention modules after acquisition cutover"],
      },
    ],
  },
];

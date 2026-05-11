import type { WorkflowModule } from "./workflow-types";

export const WORKFLOW_MODULES: WorkflowModule[] = [
  {
    id: "M1",
    short: "M1",
    title: "Module 1 — Intake + Attribution Fabric",
    purpose: "Normalize every lead and create the signal spine.",
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
          "Lead enters from FB / GHL / form / import",
          "Stamps client_account_id, subaccount_id_ghl, lead_uid, niche, source, campaign/ad metadata",
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
          "Refresh attribution / index data",
          "Prepare routing fields",
        ],
      },
      {
        id: "M1C",
        title: "Signal Dispatch / Event Ledger",
        status: "LIVE",
        bullets: [
          "Store LifecycleEvent",
          "Upsert LeadAttribution",
          "Upsert InboundContactIndex",
          "Queue Meta / event dispatch if eligible",
          "Feed Admin C.O.C. reporting",
        ],
        footnote: "Admin C.O.C. logging is LIVE for both webhook and Synthflow paths.",
      },
    ],
    fieldChips: ["client_account_id", "subaccount_id_ghl", "lead_uid"],
  },

  {
    id: "M2",
    short: "M2",
    title: "Module 2 — Smart Routing + Channel Orchestration",
    purpose: "Decide channel, timing, AI provider, and follow-up path.",
    tone: {
      container: "border-violet-200 bg-violet-50/40",
      accent: "bg-violet-500",
      eyebrow: "text-violet-700",
    },
    cards: [
      {
        id: "M2A",
        title: "Channel + AI Select",
        status: "BUILDING",
        bullets: [
          "Check routing eligibility",
          "Select BLUE / GREEN / VOICE",
          "Select CloseBot / GHL AI / NONE",
          "Lock channel and AI provider",
          "Set sa360_routing_eligibility = TRUE",
          "Final eligibility guard",
        ],
        fieldChips: ["sa360_channel_mode", "sa360_ai_mode"],
      },
      {
        id: "M2A.5",
        title: "First Touch Watcher",
        status: "BUILDING",
        bullets: [
          "If sa360_first_touch_completed != TRUE",
          "Route to first-touch send path",
          "Stamp first-touch completed after successful first outreach",
        ],
      },
      {
        id: "M2B",
        title: "Timing Gate",
        status: "BUILDING",
        bullets: [
          "Enforce allowed contact window",
          "Hold if outside window",
          "Release when safe to send",
          "Route to post-gate channel router",
        ],
      },
      {
        id: "M2FT-BLUE",
        title: "First Touch Send (BLUE)",
        status: "BUILDING",
        bullets: [
          "Send BLUE confirm or attempt message from custom values",
          "Increment contact_attempt_count and blue_attempt_count",
          "Set last_contact_attempt_ts",
          "Hand into M2C cadence",
        ],
      },
      {
        id: "M2FT-GREEN",
        title: "First Touch Send (GREEN)",
        status: "BUILDING",
        bullets: [
          "Send GREEN confirm or attempt message from custom values",
          "Increment contact_attempt_count and green_attempt_count",
          "Set last_contact_attempt_ts",
          "Hand into M2C cadence",
        ],
      },
      {
        id: "M2C",
        title: "Response + Daily Cadence",
        status: "BUILDING",
        bullets: [
          "Guard check",
          "Check reply signals",
          "If replied, route to M2D",
          "If no reply, identify follow-up day DAY_1 through DAY_8",
          "Set outbound_stage = FOLLOWUP",
          "Send through M2B timing gate",
          "Re-add to M2C after daily wait",
          "After DAY_8 with no reply, route to M2E",
        ],
        fieldChips: ["sa360_followup_day", "outbound_stage"],
      },
      {
        id: "M2C-BLUE",
        title: "Follow-Up Send (BLUE)",
        status: "BUILDING",
        bullets: [
          "Send BLUE DAY_1 through DAY_8 custom value messages",
          "Increment blue attempt count",
          "Stamp last contact attempt",
        ],
      },
      {
        id: "M2C-GREEN",
        title: "Follow-Up Send (GREEN)",
        status: "BUILDING",
        bullets: [
          "Send GREEN DAY_1 through DAY_8 custom value messages",
          "Increment green attempt count",
          "Stamp last contact attempt",
        ],
      },
      {
        id: "M2C.5",
        title: "Confirm / Remind",
        status: "BUILDING",
        bullets: [
          "If booking detected, stop normal cadence",
          "Send confirmation / reminder sequence",
          "Protect show rate",
          "Keep lead out of unnecessary follow-up",
        ],
        fieldChips: ["sa360_booking_detected"],
      },
      {
        id: "M2D",
        title: "AI Handoff",
        status: "NEXT",
        bullets: [
          "Triggered when reply detected",
          "Verify selected provider",
          "Set ai_mode = ACTIVE",
          "Set lifecycle_stage = AI_ENGAGED",
          "Stop / remove from cadence if needed",
          "Hand to CloseBot or GHL AI",
        ],
        fieldChips: ["sa360_ai_mode"],
      },
      {
        id: "M2E",
        title: "No Reply / Fallback",
        status: "NEXT",
        bullets: [
          "If BLUE and fallback allowed, trigger BLUE → GREEN fallback",
          "If no fallback available, mark review or long-term nurture",
          "Set routing_status = FALLBACK_TRIGGERED or REVIEW_REQUIRED",
        ],
        fieldChips: ["sa360_routing_status"],
      },
      {
        id: "M2F",
        title: "Voice Assist",
        status: "NEXT",
        bullets: [
          "Optional voice path",
          "Check client_voice_enabled and agent_voice_enabled",
          "Suppress overlapping texts while call_in_progress = TRUE",
          "Route into Module 3 Voice path",
        ],
        fieldChips: ["sa360_call_in_progress"],
      },
    ],
    branches: [
      { trigger: "Reply detected", target: "M2D", tone: "success" },
      { trigger: "Booking detected", target: "M2C.5", tone: "success" },
      { trigger: "No reply", target: "M2C (next day)", tone: "neutral" },
      { trigger: "Day 8 no reply", target: "M2E", tone: "failure" },
      { trigger: "Voice enabled", target: "M2F → M3V-A / B / C", tone: "next" },
    ],
    fieldChips: [
      "sa360_channel_mode",
      "sa360_ai_mode",
      "sa360_followup_day",
      "sa360_booking_detected",
      "sa360_call_in_progress",
      "sa360_routing_status",
    ],
  },

  {
    id: "M3",
    short: "M3",
    title: "Module 3 — Execution + Voice Layer",
    purpose:
      "Convert routed leads into real agent / AI actions and push outcomes back into the SA360 signal engine.",
    tone: {
      container: "border-orange-200 bg-orange-50/40",
      accent: "bg-orange-500",
      eyebrow: "text-orange-700",
    },
    cards: [
      {
        id: "M3A",
        title: "Execution Router",
        status: "NEXT",
        bullets: [
          "Determines whether next action is agent call, AI text, voice call, reminder, or review",
          "Uses channel_mode, ai_mode, voice_enabled, booking_detected, and routing_status",
          "Creates task / action context",
        ],
        fieldChips: ["sa360_channel_mode", "sa360_ai_mode", "sa360_routing_status"],
      },
      {
        id: "M3B",
        title: "Agent Action / Dialer Path",
        status: "FUTURE",
        bullets: [
          "Agent calls, dispositions, logs notes, sets appointment / sale / follow-up",
          "Updates lifecycle_stage, appointment_status, agent_disposition, policy_status",
          "Sends outcome back to SA360 event model",
        ],
      },
      {
        id: "M3C",
        title: "Outcome Sync + Signal Update",
        status: "NEXT",
        bullets: [
          "Converts agent outcomes into lifecycle events",
          "Updates Admin C.O.C.",
          "Queues Meta / signal events if eligible",
          "Feeds performance reporting",
        ],
      },
    ],
  },

  {
    id: "M3V",
    short: "M3V",
    title: "Module 3 Voice — Synthflow / Voice AI Path",
    purpose: "Voice AI call execution and result capture.",
    tone: {
      container: "border-teal-200 bg-teal-50/40",
      accent: "bg-teal-500",
      eyebrow: "text-teal-700",
    },
    cards: [
      {
        id: "M3V-A",
        title: "Voice Preflight + Dispatch",
        status: "LIVE",
        bullets: [
          "Verify voice feature toggles",
          "Resolve contact, assigned agent, number, calendar link",
          "Send outbound call request to Synthflow",
          "Log request for Admin C.O.C.",
        ],
        footnote: "Synthflow request logging is LIVE.",
      },
      {
        id: "M3V-B",
        title: "Live Voice Call + Booking Attempt",
        status: "BUILDING",
        bullets: [
          "Synthflow talks to lead",
          "Recognizes known caller / context",
          "Attempts to book or confirm appointment",
          "Captures transcript / summary / outcome",
        ],
      },
      {
        id: "M3V-C",
        title: "Voice Result Capture + Lifecycle Sync",
        status: "NEXT",
        bullets: [
          "Receive Synthflow outbound / inbound result",
          "Store voice result log",
          "Extract appointment status, call outcome, transcript summary, booking result",
          "Update GHL / SA360 fields where appropriate",
          "Create ReviewItem if failed, unknown, or needs human attention",
          "Emit lifecycle signal (appointment_set, appointment_confirmed, no_answer, failed_call, review_required)",
          "Feed Admin C.O.C. reporting and future Meta optimization",
        ],
      },
    ],
    branches: [
      { trigger: "Booking confirmed", target: "Lifecycle: appointment_set", tone: "success" },
      { trigger: "Failed / unknown", target: "ReviewItem (Review Queue)", tone: "failure" },
      { trigger: "No answer", target: "Re-queue or fallback path", tone: "neutral" },
    ],
  },
];

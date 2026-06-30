import type { WorkflowModule } from "./workflow-types";

export const WORKFLOW_MODULES: WorkflowModule[] = [
  {
    id: "LF1",
    short: "LF1",
    title: "Module LF1 - Lead Intake + Proof Vault",
    purpose:
      "Capture normalized leads from FB, webforms, LeadCapture, CSV/manual imports, and vendor feeds with proof-backed source evidence.",
    moduleStatus: "PRIORITY",
    tone: {
      container: "border-blue-200 bg-blue-50/40",
      accent: "bg-blue-500",
      eyebrow: "text-blue-700",
    },
    cards: [
      {
        id: "LF1A",
        title: "Multi-source lead intake",
        status: "BUILDING",
        bullets: [
          "Accept leads from Facebook, webforms, LeadCapture, CSV/manual import, and partner vendors.",
          "Normalize source metadata and attach source snapshots per lead record.",
          "Preserve current webhook and lifecycle ingestion paths while intake expands.",
        ],
      },
      {
        id: "LF1B",
        title: "Proof packet contract",
        status: "PRIORITY",
        bullets: [
          "Required packet keys: leadUid, sourceLeadId, sourcePlatform, sourceType, campaignId, campaignName, adsetId, adId, formId, formName.",
          "Required packet keys: landingPageUrl, referrerUrl, consentText, consentVersion, privacyPolicyVersion, termsVersion, submittedAt.",
          "Required packet keys: ipAddress, userAgent, phoneRaw, phoneE164, email, verificationStatus, proofStatus, dncSuppressionStatus, duplicateStatus.",
        ],
      },
      {
        id: "LF1C",
        title: "Proof vault and disclosure versions",
        status: "BUILDING",
        bullets: [
          "Track consent disclosure versions and source snapshots with immutable evidence references.",
          "Expose proof packet attached and consent proof available states in C.O.C. visibility.",
          "Use compliance-review-ready language and avoid legal claims that require counsel review.",
        ],
      },
      {
        id: "LF1D",
        title: "Planned LF1 models",
        status: "NEXT",
        bullets: [
          "LeadProof and ConsentDisclosureVersion",
          "LeadSourceSnapshot",
          "LeadVerificationResult, LeadSuppressionCheck, LeadQualityScore",
        ],
      },
      {
        id: "LF1E",
        title: "Proof policy rules",
        status: "NEXT",
        bullets: [
          "Define proof required vs optional rules by source type, niche, and destination policy.",
          "Hold missing-proof leads before inventory availability when required.",
        ],
      },
    ],
    fieldChips: ["lead_uid", "source_platform", "proof_status", "consent_version"],
  },
  {
    id: "LF2",
    short: "LF2",
    title: "Module LF2 - Verification + Dedupe",
    purpose:
      "Normalize phone/email, detect duplicate risks, run suppression checks, and hold questionable leads for review.",
    moduleStatus: "PRIORITY",
    tone: {
      container: "border-violet-200 bg-violet-50/40",
      accent: "bg-violet-500",
      eyebrow: "text-violet-700",
    },
    cards: [
      {
        id: "LF2A",
        title: "Verification statuses",
        status: "BUILDING",
        bullets: ["UNCHECKED", "PASSED", "FAILED", "NEEDS_REVIEW"],
      },
      {
        id: "LF2B",
        title: "Duplicate outcomes",
        status: "BUILDING",
        bullets: [
          "UNIQUE",
          "DUPLICATE_GLOBAL",
          "DUPLICATE_BUYER",
          "DUPLICATE_RECENT",
          "POSSIBLE_MATCH",
        ],
      },
      {
        id: "LF2C",
        title: "Suppression and proof checks",
        status: "PRIORITY",
        bullets: [
          "Run suppression checks and record suppression check status for each lead.",
          "Block missing proof or failed verification leads from inventory availability.",
          "Track held-for-review reasons and review outcomes in C.O.C. visibility.",
        ],
      },
      {
        id: "LF2D",
        title: "Buyer duplicate suppression",
        status: "NEXT",
        bullets: [
          "Prevent duplicate buyer delivery risk with configurable lookback windows.",
          "Separate global duplicate detection from buyer-level duplicate suppression logic.",
        ],
      },
      {
        id: "LF2E",
        title: "Quality score placeholder",
        status: "NEXT",
        bullets: [
          "Add lead quality score placeholder for future ranking and pricing logic.",
          "Keep advisory-only until quality model and governance are approved.",
        ],
      },
    ],
    branches: [
      {
        trigger: "FAILED or NEEDS_REVIEW",
        target: "HELD_FOR_REVIEW",
        tone: "failure",
      },
      { trigger: "PASSED and UNIQUE", target: "LF3 inventory", tone: "success" },
    ],
    fieldChips: ["verification_status", "duplicate_status", "suppression_check_status"],
  },
  {
    id: "LF3",
    short: "LF3",
    title: "Module LF3 - Lead Inventory Queue",
    purpose:
      "Store available leads before fulfillment and manage state transitions through reservation and delivery.",
    moduleStatus: "PRIORITY",
    tone: {
      container: "border-orange-200 bg-orange-50/40",
      accent: "bg-orange-500",
      eyebrow: "text-orange-700",
    },
    cards: [
      {
        id: "LF3A",
        title: "Inventory statuses",
        status: "BUILDING",
        bullets: [
          "RECEIVED, PROOF_PENDING, VERIFICATION_PENDING, VERIFIED, AVAILABLE",
          "RESERVED, DELIVERED, HELD_FOR_REVIEW, REJECTED, EXPIRED, REFUNDED",
        ],
      },
      {
        id: "LF3B",
        title: "Inventory fields",
        status: "PRIORITY",
        bullets: [
          "nicheKey, productType, state, sourcePlatform, sourceCampaign, leadAge",
          "proofStatus, verificationStatus, exclusivityType, priceTier, qualityScore",
          "reservedForOrderId (nullable), deliveredToClientAccountId (nullable)",
        ],
      },
      {
        id: "LF3C",
        title: "Admin C.O.C. inventory plan",
        status: "NEXT",
        bullets: [
          "Plan internal inventory table and filters for source/niche/state/proof/verification.",
          "Expose held-for-review and rejection reasons for operator action.",
        ],
      },
    ],
    branches: [
      { trigger: "Lead approved", target: "AVAILABLE", tone: "success" },
      { trigger: "Risk or mismatch", target: "HELD_FOR_REVIEW", tone: "failure" },
    ],
    fieldChips: ["niche_key", "state", "proof_status", "verification_status", "quality_score"],
  },
  {
    id: "LF4",
    short: "LF4",
    title: "Module LF4 - Lead Orders / Purchase Platform",
    purpose:
      "Allow clients and agents to submit lead orders and receive fulfillment against clear quantity and destination rules.",
    moduleStatus: "BUILDING",
    tone: {
      container: "border-teal-200 bg-teal-50/40",
      accent: "bg-teal-500",
      eyebrow: "text-teal-700",
    },
    cards: [
      {
        id: "LF4A",
        title: "Planned LF4 models",
        status: "PRIORITY",
        bullets: [
          "LeadOrder and LeadOrderLineItem",
          "LeadOrderStatePreference",
          "LeadReservation and LeadDelivery",
        ],
      },
      {
        id: "LF4B",
        title: "Order statuses",
        status: "BUILDING",
        bullets: [
          "DRAFT, PENDING_PAYMENT, ACTIVE, PARTIALLY_FULFILLED",
          "FULFILLED, PAUSED, CANCELLED, REFUNDED",
        ],
      },
      {
        id: "LF4C",
        title: "Order fields",
        status: "BUILDING",
        bullets: [
          "clientAccountId, buyerName, nicheKey, productType, requestedStates",
          "quantityRequested, quantityDelivered, priority, pricePerLead, orderTotal, paymentStatus",
          "deliveryDestinationType, ghlSubaccountId nullable, backupSheetEnabled, notes",
        ],
      },
      {
        id: "LF4D",
        title: "Order creation flows",
        status: "NEXT",
        bullets: [
          "Plan admin-created order flow for operations-managed buyers.",
          "Plan simple client order request flow in Lead Buyer Dashboard.",
          "Keep billing as placeholder only; do not add paid billing logic yet.",
        ],
      },
    ],
    branches: [
      { trigger: "Order activated", target: "LF5 matching", tone: "success" },
      { trigger: "Payment or policy issue", target: "Order review", tone: "failure" },
    ],
    fieldChips: ["order_status", "quantity_requested", "priority", "delivery_destination_type"],
  },
  {
    id: "LF5",
    short: "LF5",
    title: "Module LF5 - Fulfillment Matcher",
    purpose:
      "Match verified available leads to active orders by quantity, state, niche, proof status, verification, duplicate rules, and priority.",
    moduleStatus: "PRIORITY",
    tone: {
      container: "border-indigo-200 bg-indigo-50/40",
      accent: "bg-indigo-500",
      eyebrow: "text-indigo-700",
    },
    cards: [
      {
        id: "LF5A",
        title: "Reservation and matching logic",
        status: "BUILDING",
        bullets: [
          "Repurpose routing matcher concepts into fulfillment matching and reservation logic.",
          "Apply buyer duplicate suppression and exclusivity constraints before reservation.",
          "Prioritize by order priority, quantity remaining, state, niche, proof status, and verification status.",
        ],
      },
      {
        id: "LF5B",
        title: "Required fulfillment events",
        status: "PRIORITY",
        bullets: [
          "order_created, order_activated, lead_reserved, lead_fulfillment_started",
          "lead_delivered, lead_delivery_failed, order_partially_fulfilled, order_fulfilled",
          "lead_refunded, routing_review_required",
        ],
      },
      {
        id: "LF5C",
        title: "Delivery adapters",
        status: "PRIORITY",
        bullets: [
          "Keep current GHL delivery path as downstream fulfillment delivery adapter.",
          "Continue optional Google Sheet backup/export as non-primary destination.",
          "Do not re-position SA360 as CRM/channel orchestration; keep fulfillment-first framing.",
        ],
      },
      {
        id: "LF5D",
        title: "Delivery audit and C.O.C. visibility",
        status: "NEXT",
        bullets: [
          "Retain lifecycle signal engine usage for delivery audit, reporting, and outcomes.",
          "Expose proof, routing, fulfillment, and delivery evidence in C.O.C. views.",
        ],
      },
    ],
    branches: [
      { trigger: "No eligible inventory", target: "order_partially_fulfilled", tone: "failure" },
      { trigger: "Delivery succeeds", target: "order_fulfilled", tone: "success" },
    ],
    fieldChips: ["order_priority", "proof_status", "verification_status", "delivery_audit_status"],
  },
  {
    id: "LF6",
    short: "LF6",
    title: "Module LF6 - Lead Buyer Dashboard",
    purpose: "Simple buyer dashboard for ordering leads and receiving proof-backed deliveries.",
    moduleStatus: "NEXT",
    tone: {
      container: "border-amber-200 bg-amber-50/40",
      accent: "bg-amber-600",
      eyebrow: "text-amber-800",
    },
    cards: [
      {
        id: "LF6A",
        title: "Buy Leads / Request Leads",
        status: "NEXT",
        bullets: ["Simple order request entry for state, niche, quantity, and delivery preferences."],
      },
      {
        id: "LF6B",
        title: "My Orders",
        status: "NEXT",
        bullets: ["Track order statuses, quantities delivered, and active fulfillment progress."],
      },
      {
        id: "LF6C",
        title: "Fulfillment Progress and Delivered Leads",
        status: "NEXT",
        bullets: [
          "Show fulfillment progress card and delivered lead list.",
          "Provide lead detail view with proof packet and verification/suppression status.",
        ],
      },
      {
        id: "LF6D",
        title: "Billing placeholder",
        status: "FUTURE",
        bullets: ["Billing placeholder only until payments and legal/compliance requirements are scoped."],
      },
    ],
    fieldChips: ["client_account_id", "order_status", "quantity_delivered", "proof_status"],
  },
  {
    id: "LEGACY",
    short: "LEGACY",
    title: "Legacy / Retainer Only",
    purpose:
      "Maintain existing operational pathways for current and retainer clients without making them the core product roadmap.",
    moduleStatus: "LEGACY / RETAINER ONLY",
    tone: {
      container: "border-zinc-200 bg-zinc-50/70",
      accent: "bg-zinc-500",
      eyebrow: "text-zinc-700",
    },
    cards: [
      {
        id: "LG1",
        title: "Existing CRM support",
        status: "LEGACY / RETAINER ONLY",
        bullets: [
          "Continue CRM support for existing and retainer clients only.",
          "Do not plan new roadmap features as direct CRM platform competition.",
        ],
      },
      {
        id: "LG2",
        title: "Existing GHL workflow maintenance",
        status: "LEGACY / RETAINER ONLY",
        bullets: [
          "Maintain working GHL webhook ingestion, lifecycle events, routing dry run, and delivery readiness.",
          "Keep live delivery manually gated and disabled by default until explicit cutover decisions.",
        ],
      },
      {
        id: "LG3",
        title: "Existing Synthflow, CloseBot, and voice support",
        status: "LEGACY / RETAINER ONLY",
        bullets: [
          "Support active Synthflow, CloseBot, and voice workflows for current clients.",
          "Treat voice and channel orchestration as retained support, not net-new roadmap direction.",
        ],
      },
      {
        id: "LG4",
        title: "Existing retainer automations",
        status: "LEGACY / RETAINER ONLY",
        bullets: [
          "Keep existing retainer automations stable and observable.",
          "Allow maintenance and break-fix work without expanding new product scope.",
        ],
      },
    ],
  },
  {
    id: "DEPRECATED",
    short: "DEPR",
    title: "Deprecated / Do Not Build",
    purpose:
      "Explicit out-of-scope bets for the new roadmap. Keep code paths intact where needed, but do not build these as core differentiators.",
    moduleStatus: "DEPRECATED / DO NOT BUILD",
    tone: {
      container: "border-rose-200 bg-rose-50/60",
      accent: "bg-rose-500",
      eyebrow: "text-rose-700",
    },
    cards: [
      {
        id: "DP1",
        title: "Blue/green channel selection expansion",
        status: "DEPRECATED / DO NOT BUILD",
        bullets: [
          "Do not expand blue/green channel selection as a new roadmap pillar.",
          "Keep existing channel paths only for continuity where already active.",
        ],
      },
      {
        id: "DP2",
        title: "SendBlue fallback optimization",
        status: "DEPRECATED / DO NOT BUILD",
        bullets: [
          "Do not prioritize net-new SendBlue fallback optimization initiatives.",
          "Keep optional backup/export pathways without positioning as core product value.",
        ],
      },
      {
        id: "DP3",
        title: "New Synthflow, CloseBot, and voice feature work",
        status: "DEPRECATED / DO NOT BUILD",
        bullets: [
          "No net-new roadmap expansion around Synthflow, CloseBot, or voice orchestration.",
          "Support existing implementations under Legacy / Retainer Only boundaries.",
        ],
      },
      {
        id: "DP4",
        title: "Orion-style front-end CRM/AI competition",
        status: "DEPRECATED / DO NOT BUILD",
        bullets: [
          "Do not position SA360 as a front-end CRM/AI clone strategy.",
          "Center roadmap on verified lead supply, purchase, and fulfillment.",
        ],
      },
      {
        id: "DP5",
        title: "Advanced channel selection as core identity",
        status: "DEPRECATED / DO NOT BUILD",
        bullets: [
          "Advanced channel selection is not a core differentiator for new roadmap planning.",
          "GHL remains an optional downstream delivery destination via fulfillment adapter.",
        ],
      },
    ],
  },
];

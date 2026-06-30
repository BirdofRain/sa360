/**
 * Initial seed data for the `sa360_beta_mvp_launch` Kanban board. Seeded once
 * by `kanban.repository.ts` when the board has zero cards; after that, the DB
 * is the source of truth and this file becomes vestigial.
 */

export type LaunchKanbanSeedCard = {
  seedId: string;
  title: string;
  description: string;
  status: string;
  workstream: string;
  priority: string;
  dueDate?: Date | null;
  owner?: string | null;
  blocked?: boolean;
  dependencyCount?: number;
  tags?: string[];
  acceptanceCriteria?: string[] | null;
  dependencies?: string[] | null;
  notes?: string | null;
};

const LAUNCH_TAG = "launch-planning";

export function getLaunchKanbanSeed(): LaunchKanbanSeedCard[] {
  return [
    // -- Done -----------------------------------------------------------------
    {
      seedId: "lk-done-lifecycle-ingestion-stable",
      title: "Preserve GHL webhook ingestion and lifecycle event flow",
      description:
        "Keep existing GHL lifecycle webhook ingestion and lifecycle signal processing intact during roadmap pivot.",
      status: "DONE",
      priority: "P0",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-routing-dry-run-stable",
      title: "Preserve routing dry run path",
      description:
        "Routing dry run and review-required pathways remain available; no runtime breakage introduced by roadmap updates.",
      status: "DONE",
      priority: "P0",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-readiness-guard-stable",
      title: "Preserve delivery readiness and live-delivery guards",
      description:
        "Keep delivery readiness checks and manual canary safeguards. Do not auto-enable live delivery.",
      status: "DONE",
      priority: "P0",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
      notes: "GHL_DELIVERY_ADAPTER_MODE remains disabled in production until explicit cutover approval.",
    },
    {
      seedId: "lk-done-portal-routes-stable",
      title: "Preserve existing portal routes",
      description:
        "Keep current client portal routes functional while dashboard direction shifts to simple lead buyer experiences.",
      status: "DONE",
      priority: "P1",
      workstream: "Dashboard",
      tags: [LAUNCH_TAG],
    },

    // -- In Progress This Week ------------------------------------------------
    {
      seedId: "lk-doing-strategy-pivot-roadmap",
      title: "Pivot roadmap to SA360 Lead Fulfillment OS",
      description:
        "Reframe roadmap language away from CRM/voice/channel orchestration and toward verified lead fulfillment outcomes.",
      status: "DOING",
      priority: "P0",
      workstream: "Strategy",
      owner: "Sam",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-doing-strategy-system-map-update",
      title: "Update system map for proof, inventory, orders, and fulfillment",
      description:
        "Update planning architecture and workflow maps to LF1-LF6 modules and fulfillment-first data flow.",
      status: "DOING",
      priority: "P0",
      workstream: "Strategy",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-doing-strategy-boundary-definition",
      title: "Define legacy CRM and voice AI support boundary",
      description:
        "Add explicit Legacy / Retainer Only boundaries for existing CRM, GHL maintenance, Synthflow, CloseBot, and voice support.",
      status: "DOING",
      priority: "P0",
      workstream: "Strategy",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-doing-strategy-deprecate-channel-expansion",
      title: "Mark blue/green and channel orchestration expansion deprecated",
      description:
        "Document Deprecated / Do Not Build direction for blue/green expansion, advanced channel selection, and Orion-style front-end competition.",
      status: "DOING",
      priority: "P0",
      workstream: "Strategy",
      tags: [LAUNCH_TAG],
    },

    // -- Next -----------------------------------------------------------------
    {
      seedId: "lk-next-proof-leadproof-schema",
      title: "Design LeadProof schema",
      description: "Define LeadProof model contract for proof-backed lead evidence packets.",
      status: "TO DO",
      priority: "P0",
      workstream: "Lead Proof",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-proof-disclosure-schema",
      title: "Design ConsentDisclosureVersion schema",
      description: "Define disclosure versioning contract for consent, privacy, and terms evidence.",
      status: "TO DO",
      priority: "P0",
      workstream: "Lead Proof",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-proof-source-mapping",
      title: "Map proof fields from FB/webforms/LeadCapture/CSV",
      description:
        "Map source payloads into proof packet keys and document required vs optional proof fields.",
      status: "TO DO",
      priority: "P0",
      workstream: "Lead Proof",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-proof-coc-plan",
      title: "Add proof packet to C.O.C. plan",
      description: "Plan proof packet visibility across routing, fulfillment, and delivery audit surfaces.",
      status: "TO DO",
      priority: "P1",
      workstream: "Lead Proof",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-proof-required-optional-rules",
      title: "Define proof required vs optional rules",
      description:
        "Specify policy for when missing proof should hold, reject, or allow staged inventory status.",
      status: "TO DO",
      priority: "P1",
      workstream: "Lead Proof",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-verify-dedupe-rules",
      title: "Design dedupe rules",
      description: "Define global, buyer, recent-window, and possible-match duplicate logic.",
      status: "TO DO",
      priority: "P0",
      workstream: "Verification/Dedupe",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-verify-buyer-suppression",
      title: "Design buyer-level duplicate suppression",
      description: "Add buyer-specific suppression and duplicate-delivery risk policies.",
      status: "TO DO",
      priority: "P0",
      workstream: "Verification/Dedupe",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-verify-status-model",
      title: "Design verification statuses",
      description: "Implement UNCHECKED, PASSED, FAILED, and NEEDS_REVIEW state model.",
      status: "TO DO",
      priority: "P0",
      workstream: "Verification/Dedupe",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-verify-review-reasons",
      title: "Add held-for-review reasons",
      description:
        "Define reason taxonomy for held verification/proof/suppression outcomes and operator review.",
      status: "TO DO",
      priority: "P1",
      workstream: "Verification/Dedupe",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-verify-quality-score-placeholder",
      title: "Add lead quality score placeholder",
      description:
        "Add placeholder quality scoring field and keep non-blocking until scoring policy is approved.",
      status: "TO DO",
      priority: "P2",
      workstream: "Verification/Dedupe",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-inventory-model",
      title: "Design LeadInventory model",
      description: "Define queue storage contract for pre-fulfillment lead inventory records.",
      status: "TO DO",
      priority: "P0",
      workstream: "Inventory",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-inventory-lifecycle-statuses",
      title: "Add inventory lifecycle statuses",
      description:
        "Implement RECEIVED -> AVAILABLE and downstream RESERVED/DELIVERED/REFUNDED status transitions.",
      status: "TO DO",
      priority: "P0",
      workstream: "Inventory",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-inventory-admin-table",
      title: "Plan internal inventory table in Admin C.O.C.",
      description: "Plan inventory queue table and operator actions in internal C.O.C.",
      status: "TO DO",
      priority: "P1",
      workstream: "Inventory",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-inventory-filtering",
      title: "Add filters for source/niche/state/proof/verification",
      description: "Define filter dimensions and default views for inventory operations.",
      status: "TO DO",
      priority: "P1",
      workstream: "Inventory",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-orders-model",
      title: "Design LeadOrder model",
      description: "Define buyer order contract with quantity, priority, and destination fields.",
      status: "TO DO",
      priority: "P0",
      workstream: "Orders",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-orders-line-item-model",
      title: "Design LeadOrderLineItem model",
      description: "Define line-item state/niche/requested-state structures for orders.",
      status: "TO DO",
      priority: "P0",
      workstream: "Orders",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-orders-statuses",
      title: "Add order statuses",
      description: "Implement DRAFT through REFUNDED order status lifecycle.",
      status: "TO DO",
      priority: "P0",
      workstream: "Orders",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-orders-admin-flow",
      title: "Plan admin-created order flow",
      description: "Plan operator-created order path for managed client accounts.",
      status: "TO DO",
      priority: "P1",
      workstream: "Orders",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-orders-client-request-flow",
      title: "Plan client order request dashboard",
      description: "Plan simple buyer-request order flow in the client dashboard.",
      status: "TO DO",
      priority: "P1",
      workstream: "Orders",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-fulfillment-repurpose-matcher",
      title: "Repurpose routing matcher into fulfillment matcher",
      description:
        "Reuse routing matching concepts to allocate available verified leads to active orders.",
      status: "TO DO",
      priority: "P0",
      workstream: "Fulfillment",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-fulfillment-reservation-logic",
      title: "Add reservation logic",
      description: "Implement reservation lifecycle before delivery for matched leads.",
      status: "TO DO",
      priority: "P0",
      workstream: "Fulfillment",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-fulfillment-priority-match",
      title: "Add order priority matching",
      description:
        "Support prioritized fulfillment by quantity, state, niche, proof/verification status, and order priority.",
      status: "TO DO",
      priority: "P0",
      workstream: "Fulfillment",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-fulfillment-audit-events",
      title: "Add delivery audit event list",
      description: "Implement order/lead fulfillment and delivery audit event taxonomy.",
      status: "TO DO",
      priority: "P1",
      workstream: "Fulfillment",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-fulfillment-ghl-adapter",
      title: "Keep GHL delivery adapter as downstream output",
      description:
        "Preserve GHL create/update/tag/workflow delivery path as optional downstream fulfillment adapter.",
      status: "TO DO",
      priority: "P0",
      workstream: "Fulfillment",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-fulfillment-optional-sheet-backup",
      title: "Keep Google Sheet backup/export optional",
      description: "Keep optional sheet backup/export as non-primary fallback destination.",
      status: "TO DO",
      priority: "P2",
      workstream: "Fulfillment",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-dashboard-rename-direction",
      title: "Rename portal direction to Lead Buyer Dashboard",
      description:
        "Reframe client-facing product direction from broad portal to simple lead buyer dashboard.",
      status: "TO DO",
      priority: "P0",
      workstream: "Dashboard",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-dashboard-my-orders",
      title: "Plan My Orders page",
      description: "Define basic buyer order management page for active and historical orders.",
      status: "TO DO",
      priority: "P1",
      workstream: "Dashboard",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-dashboard-delivered-leads",
      title: "Plan Delivered Leads page",
      description: "Define delivered lead list with order and fulfillment context.",
      status: "TO DO",
      priority: "P1",
      workstream: "Dashboard",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-dashboard-lead-detail-proof",
      title: "Plan Lead Detail + Proof Packet page",
      description: "Define lead detail UX with proof packet, verification, and suppression views.",
      status: "TO DO",
      priority: "P1",
      workstream: "Dashboard",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-dashboard-fulfillment-progress",
      title: "Plan Fulfillment Progress card",
      description: "Define fulfillment progress widget for delivered/remaining quantity visibility.",
      status: "TO DO",
      priority: "P1",
      workstream: "Dashboard",
      tags: [LAUNCH_TAG],
    },

    // -- Blocked / Needs Info -------------------------------------------------
    {
      seedId: "lk-block-legal-review-language",
      title: "Legal language guardrails for compliance claims",
      description:
        "Ensure UI/docs use proof packet attached and compliance-review-ready language; avoid unreviewed legal claims.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Strategy",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-db-seed-vs-live-board",
      title: "Live board update path for already-seeded Kanban",
      description:
        "Seed updates only affect fresh boards. Existing DB-backed board must be updated through UI/API card edits.",
      status: "VERIFY",
      priority: "P1",
      workstream: "Strategy",
      blocked: true,
      tags: [LAUNCH_TAG],
    },

    // -- Later ----------------------------------------------------------------
    {
      seedId: "lk-later-legacy-crm-support",
      title: "Existing CRM workflow support",
      description: "Support existing CRM workflows for current and retainer clients only.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-legacy-ghl-maintenance",
      title: "Existing GHL automation fixes",
      description: "Maintain and fix existing GHL automations where operationally required.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-legacy-synthflow-closebot-voice",
      title: "Existing Synthflow / CloseBot / voice support",
      description:
        "Continue support for existing client implementations without creating new roadmap initiatives.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-legacy-retainer-automation-support",
      title: "Existing retainer client support",
      description: "Continue maintenance for existing retainer automations and client workflows.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Legacy / Retainer Only",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-deprecated-blue-green-expansion",
      title: "Blue/green channel selection expansion",
      description: "Deprecated for new roadmap. Keep only existing behavior where currently active.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Deprecated / Do Not Build",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-deprecated-sendblue-optimization",
      title: "SendBlue fallback optimization",
      description: "Deprecated for new roadmap; optional backup paths remain non-core.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Deprecated / Do Not Build",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-deprecated-new-voice-roadmap",
      title: "New voice AI roadmap work",
      description: "Deprecated for new roadmap. Do not build new voice orchestration features.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Deprecated / Do Not Build",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-deprecated-new-synthflow-closebot-work",
      title: "New Synthflow and CloseBot feature work",
      description: "Deprecated for new roadmap unless scope changes by explicit product decision.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Deprecated / Do Not Build",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-deprecated-orion-clone",
      title: "Orion-style front-end AI/CRM clone",
      description: "Deprecated as a strategic direction for SA360 product roadmap.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Deprecated / Do Not Build",
      tags: [LAUNCH_TAG],
    },
  ];
}

export const LAUNCH_KANBAN_DEFAULT_BOARD_KEY = "sa360_beta_mvp_launch";
export const LAUNCH_KANBAN_DEFAULT_BOARD_NAME = "SA360 Lead Fulfillment OS Roadmap";

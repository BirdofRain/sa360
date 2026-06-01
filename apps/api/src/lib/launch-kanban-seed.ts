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
    // ── Done ─────────────────────────────────────────────────────────────
    {
      seedId: "lk-done-portal-mvp",
      title: "Client Portal MVP",
      description:
        "Client-facing portal shell with login gate, dashboard layout, and operational metrics surfaces.",
      status: "DONE",
      priority: "P0",
      workstream: "Client Portal",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-portal-login",
      title: "Client Portal Login / Session Protection",
      description: "/portal/login with httpOnly session cookie and protected dashboard routes.",
      status: "DONE",
      priority: "P0",
      workstream: "Client Portal",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-portal-dashboard-api",
      title: "Live Client Dashboard API",
      description:
        "Client-scoped dashboard API wired to Postgres summary/read models for live portal metrics.",
      status: "DONE",
      priority: "P0",
      workstream: "Client Portal",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-routing-registry",
      title: "Routing Registry + Dry Run Matcher",
      description:
        "Campaign routing rules loaded from registry; matcher produces dry-run decisions without live delivery.",
      status: "DONE",
      priority: "P0",
      workstream: "Routing",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-routing-dry-run-ui",
      title: "Routing Dry Run C.O.C. UI",
      description: "Internal /routing-dry-run page for operators to review match outcomes before cutover.",
      status: "DONE",
      priority: "P0",
      workstream: "Admin C.O.C.",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-shadow-plan",
      title: "Shadow Delivery Plan Generation",
      description:
        "LeadDeliveryPlan shadow records generated from routing decisions — no live GHL writes.",
      status: "DONE",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-legacy-compare",
      title: "Legacy Delivery Comparison / Operator Review",
      description:
        "Side-by-side legacy vs SA360 delivery comparison for operator sign-off before canary.",
      status: "DONE",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-readiness",
      title: "Delivery Readiness Guard",
      description:
        "Readiness checks gate shadow → simulation → live canary paths. Production adapter stays disabled by default.",
      status: "DONE",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
      notes: "GHL_DELIVERY_ADAPTER_MODE must remain disabled in production until explicit cutover.",
    },
    {
      seedId: "lk-done-ghl-sim",
      title: "GHL Adapter Simulation",
      description:
        "Simulated GHL write transport validates payloads and field mapping without live API calls in prod.",
      status: "DONE",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-dup-risk",
      title: "Duplicate / Identity Risk Review",
      description:
        "LeadDuplicateRiskAssessment surfaced for operator review before any live delivery attempt.",
      status: "DONE",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-done-canary-code",
      title: "Guarded Live Canary Delivery Code",
      description:
        "assertLiveDeliveryAllowed + duplicate-risk guard + GhlLiveDeliveryRun path implemented. Code-complete; disabled in production until cutover approval.",
      status: "DONE",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
      notes: "Manual-only live canary. No automatic lead_created → live delivery. Zapier/legacy remains active until confirmed.",
    },

    // ── In Progress This Week ───────────────────────────────────────────
    {
      seedId: "lk-doing-deploy-4i",
      title: "Deploy + verify Phase 4I safely",
      description:
        "Run migrations; verify Routing Dry Run, Delivery Readiness, Duplicate/Identity, and GHL Adapter Simulation. Keep production GHL adapter disabled.",
      status: "DOING",
      priority: "P0",
      workstream: "Infra & Deploy",
      owner: "Sam",
      tags: [LAUNCH_TAG],
      acceptanceCriteria: [
        "Migrations applied on staging/production",
        "Routing Dry Run returns expected decisions",
        "Delivery Readiness + Duplicate checks green on test leads",
        "GHL_DELIVERY_ADAPTER_MODE still disabled in production",
      ],
    },
    {
      seedId: "lk-doing-ghl-pipeline-contract",
      title: "Define GHL Opportunity / Pipeline contract",
      description:
        "Document standard client pipeline stages, stage-to-SA360 lifecycle mapping, workflow triggers, inbound GHL lifecycle signals, and custom-field automation rules.",
      status: "DOING",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-doing-onboarding-ui",
      title: "Build Client Onboarding + Routing Rule Management",
      description:
        "Internal setup for client profile, GHL subaccount, campaign routing rules, niche/product, destination workflow ID, pipeline/stage IDs, assigned user, snapshot/fields installed, portal enabled, and delivery readiness checklist.",
      status: "DOING",
      priority: "P0",
      workstream: "Onboarding",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-doing-bre-pilot",
      title: "Configure Breanna VET FEX as pilot client",
      description:
        "First true client record: breanna_kimberling · VET Final Expense · HZ97NWGIViy5udec20Ir · campaign Breanne Kimberling- Vet FEX- 4/30/26. Fill workflow/pipeline/stage/user IDs; verify snapshot + fields; run shadow plan + adapter sim; mark legacy comparisons on real leads.",
      status: "DOING",
      priority: "P0",
      workstream: "Onboarding",
      tags: [LAUNCH_TAG],
      notes: "Pilot config only — not hardcoded in delivery source logic.",
    },
    {
      seedId: "lk-doing-bre-portal-scope",
      title: "Client portal config / scoping for Bre",
      description:
        "Map Bre login to breanna_kimberling; portal shows Bre-specific metrics. Prepare GHL custom menu link / embedded portal path. Keep internal C.O.C. separate from client portal.",
      status: "DOING",
      priority: "P0",
      workstream: "Client Portal",
      tags: [LAUNCH_TAG],
    },

    // ── Next ────────────────────────────────────────────────────────────
    {
      seedId: "lk-next-ghl-menu",
      title: "GHL custom menu link / embedded client portal",
      description:
        "Client access point inside GHL pointing to SA360 portal / action center with scoped metrics.",
      status: "TO DO",
      priority: "P1",
      workstream: "Client Portal",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-bre-canary",
      title: "First Bre VET live canary",
      description:
        "One controlled live delivery only after readiness green, duplicate risk clear, adapter simulation passed, legacy validation matched, and explicit approval flags set. Zapier remains active until confirmed.",
      status: "TO DO",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
      dependencies: ["lk-doing-bre-pilot", "lk-done-canary-code"],
      dependencyCount: 2,
    },
    {
      seedId: "lk-next-cutover-runbook",
      title: "Cutover runbook + rollback plan",
      description:
        "Operator runbook for enabling live adapter per client, rollback steps, and Zapier decommission checklist.",
      status: "TO DO",
      priority: "P0",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-next-replace-zapier-bre",
      title: "Replace Zapier path for Bre only after canary success",
      description:
        "Decommission legacy Zapier delivery for Breanna VET FEX only after live canary validated end-to-end.",
      status: "TO DO",
      priority: "P1",
      workstream: "Delivery & GHL",
      tags: [LAUNCH_TAG],
      dependencies: ["lk-next-bre-canary"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-next-expand-vet-routing",
      title: "Expand routing rules for Sean / Simone / other VET campaigns",
      description:
        "Add campaign routing registry entries for additional VET producers after Bre pilot proves the path.",
      status: "TO DO",
      priority: "P2",
      workstream: "Routing",
      tags: [LAUNCH_TAG],
    },

    // ── Blocked / Needs Info ────────────────────────────────────────────
    {
      seedId: "lk-block-bre-workflow-id",
      title: "Bre workflow ID",
      description: "Destination GHL workflow ID for Breanna VET FEX delivery — needed for onboarding config.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Onboarding",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-bre-pipeline-id",
      title: "Bre pipeline ID",
      description: "GHL opportunity pipeline ID for Breanna subaccount.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Onboarding",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-bre-stage-ids",
      title: "Bre pipeline stage IDs",
      description: "Stage IDs for new lead, contacted, appointment, and sold stages in Bre pipeline.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Onboarding",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-bre-user-id",
      title: "Assigned user ID",
      description: "GHL user ID for default lead assignment on Breanna account.",
      status: "VERIFY",
      priority: "P1",
      workstream: "Onboarding",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-field-ids",
      title: "Custom field IDs / field install verification",
      description:
        "Confirm SA360 snapshot custom fields are installed in Bre subaccount with correct IDs for delivery mapping.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Onboarding",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-opp-contract",
      title: "GHL opportunity contract decision",
      description:
        "Finalize which opportunity fields, stages, and lifecycle webhooks are canonical before building pipeline UI.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Delivery & GHL",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-backup-sheet",
      title: "Backup sheet access / strategy",
      description:
        "Decide whether Google Sheet backup remains, is replaced, or is export-only during cutover.",
      status: "VERIFY",
      priority: "P2",
      workstream: "Onboarding",
      blocked: true,
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-block-ghl-token",
      title: "GHL token / private integration readiness",
      description:
        "Private integration token scoped for Bre subaccount live writes when canary is approved.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Delivery & GHL",
      blocked: true,
      tags: [LAUNCH_TAG],
    },

    // ── Later ───────────────────────────────────────────────────────────
    {
      seedId: "lk-later-multi-portal-auth",
      title: "Multi-client portal auth",
      description: "Per-client credentials or SSO beyond single-pilot portal login.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Client Portal",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-onboarding-wizard",
      title: "Automated onboarding wizard",
      description: "Self-serve or semi-automated client setup without operator-heavy config.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Onboarding",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-global-stats",
      title: "Global stats across all clients",
      description: "Cross-tenant executive dashboard for internal leadership.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Admin C.O.C.",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-post-sale",
      title: "Post-sale nurture / referral / reactivation modules",
      description: "Module 6 retention automations beyond acquisition + appointment focus.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Future Platform",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-sheet-replace",
      title: "Google Sheet backup replacement / export",
      description: "Replace or automate legacy sheet backup once Postgres + GHL are source of truth.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Onboarding",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-first-orion",
      title: "First Orion number health integration",
      description: "Number reputation / number health system evaluation and integration.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Future Platform",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-jasper",
      title: "Jasper Vocal Agent live transfers",
      description: "Potential live transfer / vocal agent path — exploring fit with Synthflow stack.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Synthflow Voice",
      tags: [LAUNCH_TAG],
    },
    {
      seedId: "lk-later-multi-niche",
      title: "Broader multi-niche rollout",
      description: "Expand beyond VET Final Expense pilot to additional niches and producers.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Routing",
      tags: [LAUNCH_TAG],
    },
  ];
}

export const LAUNCH_KANBAN_DEFAULT_BOARD_KEY = "sa360_beta_mvp_launch";
export const LAUNCH_KANBAN_DEFAULT_BOARD_NAME = "SA360 Launch & Cutover Planning";

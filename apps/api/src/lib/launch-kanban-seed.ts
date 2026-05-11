/**
 * Initial seed data for the `sa360_beta_mvp_launch` Kanban board. Seeded once
 * by `kanban.repository.ts` when the board has zero cards; after that, the DB
 * is the source of truth and this file becomes vestigial.
 *
 * Card shape mirrors the Prisma `KanbanCard` model (minus generated columns):
 * - `acceptanceCriteria` and `dependencies` are JSON arrays of strings.
 * - `sortOrder` is column-local. We allocate in steps of 10 so manual reorders
 *   have headroom without requiring a full re-numbering on every move.
 */

export type LaunchKanbanSeedCard = {
  /** Stable seed id (used for de-dup when re-seeding test envs). */
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
  /** Free-form list of seed ids this card depends on. */
  dependencies?: string[] | null;
  notes?: string | null;
};

/**
 * Returns a fresh array each call so the caller can assign sortOrder without
 * mutating a shared module-level constant.
 */
export function getLaunchKanbanSeed(): LaunchKanbanSeedCard[] {
  return [
    // ── DONE ────────────────────────────────────────────────────────────
    {
      seedId: "lk-done-api-live",
      title: "Production API live on DigitalOcean",
      description:
        "Fastify SA360 API serving GHL lifecycle webhooks and Synthflow lookups from the production DO droplet. TLS, ingress, and process supervision verified.",
      status: "DONE",
      priority: "P0",
      workstream: "Infra & Deploy",
      owner: "Sam",
      acceptanceCriteria: [
        "API reachable at production origin with TLS",
        "Health endpoint returns 200",
        "Process restarts on crash",
      ],
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-worker-pg-valkey",
      title: "Worker + Postgres + Valkey deployed",
      description:
        "BullMQ worker, Postgres primary, and Valkey/Redis instance running in DO and connected to the API.",
      status: "DONE",
      priority: "P0",
      workstream: "Infra & Deploy",
      owner: "Sam",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-ghl-webhook-ingest",
      title: "GHL lifecycle webhook ingestion live",
      description:
        "POST /webhooks/ghl-lifecycle authenticates inbound webhooks, validates payloads, and persists LifecycleEvent + LeadAttribution + InboundContactIndex.",
      status: "DONE",
      priority: "P0",
      workstream: "Webhooks",
      owner: "Sam",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-webhook-log",
      title: "WebhookRequestLog added and deployed",
      description:
        "All inbound webhook requests are logged with redacted request body, processing status, HTTP status, and timing.",
      status: "DONE",
      priority: "P0",
      workstream: "Webhooks",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-synthflow-log",
      title: "SynthflowRequestLog added and deployed",
      description:
        "Inbound Synthflow lookups logged with caller matched-by signal, lookup status, and routing result. Outbound results also captured.",
      status: "DONE",
      priority: "P0",
      workstream: "Synthflow Voice",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-admin-api",
      title: "Admin API /admin/v1 endpoints live",
      description:
        "Server-key-gated admin endpoints expose webhook requests, Synthflow requests, outbound results, and summary metrics for the C.O.C. dashboard.",
      status: "DONE",
      priority: "P0",
      workstream: "API",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-coc-frontend",
      title: "Admin C.O.C. frontend deployed",
      description:
        "Next.js admin dashboard deployed and reading from the admin API. Shell, header, and sidebar match the Figma reference.",
      status: "DONE",
      priority: "P0",
      workstream: "Admin C.O.C.",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-real-reporting",
      title: "Real webhook and Synthflow reporting visible",
      description:
        "Command Center KPIs, webhook monitor, and Synthflow monitor surface live data from the admin API rather than placeholder values.",
      status: "DONE",
      priority: "P0",
      workstream: "Reporting",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-done-figma-master",
      title: "Figma master project overview created",
      description:
        "Master Figma file with admin dashboard reference, workflow map sketches, and architecture map for stakeholder reviews.",
      status: "DONE",
      priority: "P2",
      workstream: "Design / Figma",
    },

    // ── VERIFY ──────────────────────────────────────────────────────────
    {
      seedId: "lk-verify-newest-webhook",
      title: "Confirm newest GHL webhook appears in dashboard",
      description:
        "Send a freshly-stamped lifecycle webhook from staging GHL and confirm it lands in the Webhook Monitor list within a few seconds.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Webhooks",
      tags: ["beta-mvp"],
      dependencies: ["lk-done-ghl-webhook-ingest", "lk-done-real-reporting"],
      dependencyCount: 2,
      acceptanceCriteria: [
        "Webhook row appears within 5s of receipt",
        "Status badge matches DB processingStatus",
        "Payload sample matches redacted request body",
      ],
    },
    {
      seedId: "lk-verify-newest-synth",
      title: "Confirm newest Synthflow lookup appears in dashboard",
      description:
        "Place a Synthflow inbound test call and verify the lookup row renders in the Synthflow Voice page with the right matched-by signal.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Synthflow Voice",
      tags: ["beta-mvp"],
      dependencies: ["lk-done-synthflow-log"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-verify-admin-key-safety",
      title: "Verify admin key is not exposed to browser",
      description:
        "Audit network panel + bundle output to confirm SA360_ADMIN_API_KEY never leaks past server components. Update README if needed.",
      status: "VERIFY",
      priority: "P0",
      workstream: "Security",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-verify-metric-parity",
      title: "Verify dashboard metrics match database counts",
      description:
        "Compare Command Center KPIs against raw SQL counts for the same time window. Reconcile any drift before beta calls.",
      status: "VERIFY",
      priority: "P1",
      workstream: "Reporting",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-verify-redaction",
      title: "Verify redacted payloads show enough debugging data",
      description:
        "Walk the redaction layer; ensure operators can debug a failed webhook from the request body alone without exposing secrets.",
      status: "VERIFY",
      priority: "P1",
      workstream: "Security",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-verify-do-env",
      title: "Verify DO env vars are cleaned up",
      description:
        "Remove unused legacy env vars from the DO app spec. Make sure required public + server-only vars are present and correctly scoped.",
      status: "VERIFY",
      priority: "P1",
      workstream: "Infra & Deploy",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-verify-env-naming",
      title: "Verify production/staging naming is clear",
      description:
        "Header pill, log line prefixes, and config naming all consistently use the same staging/production labels — no mixed branding.",
      status: "VERIFY",
      priority: "P2",
      workstream: "Admin C.O.C.",
      tags: ["beta-mvp"],
    },

    // ── DOING ───────────────────────────────────────────────────────────
    {
      seedId: "lk-doing-review-model",
      title: "Build Review Queue model and endpoints",
      description:
        "Add `ReviewItem` Prisma model + `/admin/v1/review-items` list/detail endpoints. Items are emitted by webhook + Synthflow paths for human attention.",
      status: "DOING",
      priority: "P0",
      workstream: "Review Queue",
      owner: "Sam",
      tags: ["beta-mvp"],
      acceptanceCriteria: [
        "ReviewItem migration applied to staging",
        "List endpoint supports status + reason filters",
        "Detail endpoint returns linked webhook/Synthflow refs",
      ],
    },
    {
      seedId: "lk-doing-review-wire-ui",
      title: "Wire Review Queue page to live data",
      description:
        "Replace placeholder card on /review with a real list + detail drawer pulling from /admin/v1/review-items.",
      status: "DOING",
      priority: "P0",
      workstream: "Review Queue",
      tags: ["beta-mvp"],
      dependencies: ["lk-doing-review-model"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-doing-client-list",
      title: "Add client/subaccount list endpoint",
      description:
        "Expose `/admin/v1/clients` returning client_account_id + subaccount_id_ghl rows for the Clients page and filters.",
      status: "DOING",
      priority: "P1",
      workstream: "API",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-doing-client-detail-shell",
      title: "Add client detail page shell",
      description:
        "Stand up /clients/detail shell with sections for routing, recent webhooks, Synthflow lookups, and feature flags. Empty states first, data later.",
      status: "DOING",
      priority: "P1",
      workstream: "Admin C.O.C.",
      tags: ["beta-mvp"],
      dependencies: ["lk-doing-client-list"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-doing-webhook-filters",
      title: "Add filtering to Webhook Monitor",
      description:
        "Hook the existing webhook filter form up to admin API query params + URL state. Source, processingStatus, clientAccountId, and date range.",
      status: "DOING",
      priority: "P1",
      workstream: "Webhooks",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-doing-synth-filters",
      title: "Add filtering to Synthflow Monitor",
      description:
        "Same pattern as Webhook Monitor: knownCaller, lookupStatus, matchedBy, client, and time range — wired to URL params.",
      status: "DOING",
      priority: "P1",
      workstream: "Synthflow Voice",
      tags: ["beta-mvp"],
    },

    // ── TO DO ───────────────────────────────────────────────────────────
    {
      seedId: "lk-todo-flag-model",
      title: "Add FeatureFlag model",
      description:
        "Prisma model + admin endpoints for boolean/enum flags keyed by client and (optionally) subaccount. Cache in Valkey for hot reads.",
      status: "TO DO",
      priority: "P0",
      workstream: "Feature Flags",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-todo-flag-toggles",
      title: "Build Voice / Blue / Green / Meta toggles",
      description:
        "Surface the core toggles on /flags. Toggle writes go through admin endpoints + AuditLog.",
      status: "TO DO",
      priority: "P0",
      workstream: "Feature Flags",
      tags: ["beta-mvp"],
      dependencies: ["lk-todo-flag-model", "lk-todo-audit-log"],
      dependencyCount: 2,
    },
    {
      seedId: "lk-todo-audit-log",
      title: "Add AuditLog for admin changes",
      description:
        "Record every admin write (flag toggle, manual review resolution, client config edit) with actor, before/after, and timestamp.",
      status: "TO DO",
      priority: "P1",
      workstream: "Security",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-todo-review-validation",
      title: "Add ReviewItem creation for validation failures",
      description:
        "When a webhook is rejected with `validation_failed`, create a ReviewItem so operators can triage without scanning logs.",
      status: "TO DO",
      priority: "P0",
      workstream: "Review Queue",
      tags: ["beta-mvp"],
      dependencies: ["lk-doing-review-model"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-todo-review-unknown-callers",
      title: "Add ReviewItem creation for unknown callers",
      description:
        "Synthflow lookups that fail to match a contact should generate a ReviewItem with the inbound number and any partial signal.",
      status: "TO DO",
      priority: "P1",
      workstream: "Review Queue",
      tags: ["beta-mvp"],
      dependencies: ["lk-doing-review-model"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-todo-review-meta-fail",
      title: "Add ReviewItem creation for Meta dispatch failures",
      description:
        "Worker emits a ReviewItem when a Meta CAPI dispatch ultimately fails after retries, with last error + payload reference.",
      status: "TO DO",
      priority: "P1",
      workstream: "Review Queue",
      tags: ["beta-mvp"],
      dependencies: ["lk-doing-review-model"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-todo-admin-pagination",
      title: "Add pagination to admin tables",
      description:
        "Cursor-based pagination on Webhook Monitor, Synthflow Voice, and Review Queue. Server already returns nextCursor; surface controls in the UI.",
      status: "TO DO",
      priority: "P1",
      workstream: "Admin C.O.C.",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-todo-link-logs-events",
      title: "Add detail drawer links between logs and lifecycle events",
      description:
        "From a Synthflow row, deep-link to the matched contact's lifecycle timeline. From a webhook row, link to created LifecycleEvent.",
      status: "TO DO",
      priority: "P2",
      workstream: "Admin C.O.C.",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-todo-custom-domain-admin",
      title: "Add custom domain for admin dashboard",
      description:
        "Wire admin.smartagent360.com (or chosen subdomain) with TLS, redirect from the temporary DO URL, and update README.",
      status: "TO DO",
      priority: "P2",
      workstream: "Infra & Deploy",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-todo-rotate-secrets",
      title: "Rotate exposed/temporary secrets",
      description:
        "Rotate any keys that were pasted into shared chats during build-out. Document rotation cadence for ADMIN_API_KEY + webhook signing secrets.",
      status: "TO DO",
      priority: "P0",
      workstream: "Security",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-todo-smoke-test",
      title: "Add deployment smoke test script",
      description:
        "Single command that hits health, admin metrics summary, and one webhook fixture post-deploy and fails CI/script on regression.",
      status: "TO DO",
      priority: "P1",
      workstream: "Infra & Deploy",
      tags: ["beta-mvp"],
    },

    // ── SPRINT ──────────────────────────────────────────────────────────
    {
      seedId: "lk-sprint-coc-ops",
      title: "Turn C.O.C. into operations dashboard",
      description:
        "Promote the Command Center from KPI-grid to a full operations-control surface: alerts, drilldowns, and per-client health.",
      status: "SPRINT",
      priority: "P0",
      workstream: "Admin C.O.C.",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-sprint-m1-stable",
      title: "Stabilize GHL Module 1 payloads",
      description:
        "Confirm every M1 webhook variant (intake, normalize, dispatch) carries the canonical SA360 fields with no upstream drift.",
      status: "SPRINT",
      priority: "P0",
      workstream: "Webhooks",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-sprint-m2-routing",
      title: "Confirm Module 2 routing fields",
      description:
        "Lock down channel_mode, ai_mode, routing_status, booking_detected, and follow-up day fields with M2 owner.",
      status: "SPRINT",
      priority: "P0",
      workstream: "Webhooks",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-sprint-demo-checklist",
      title: "Build beta demo checklist",
      description:
        "Step-by-step demo runbook: data to prep, screens to walk, fallback story when a live webhook is slow.",
      status: "SPRINT",
      priority: "P1",
      workstream: "Onboarding",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-sprint-client-setup",
      title: "Build first client setup checklist",
      description:
        "Canonical onboarding checklist for the first paying client — webhooks wired, flags set, owners assigned, success metrics defined.",
      status: "SPRINT",
      priority: "P1",
      workstream: "Onboarding",
      tags: ["beta-mvp"],
    },
    {
      seedId: "lk-sprint-success-metrics",
      title: "Define launch-ready success metrics",
      description:
        "What does 'launch-ready' mean numerically? Webhook ingest success rate, Synthflow match rate, time-to-first-contact, review backlog.",
      status: "SPRINT",
      priority: "P1",
      workstream: "Reporting",
      tags: ["beta-mvp"],
    },

    // ── BCKLG ───────────────────────────────────────────────────────────
    {
      seedId: "lk-back-admin-users",
      title: "Admin user accounts",
      description:
        "Replace the single shared admin key with per-user admin accounts. Foundation for AuditLog actor identity.",
      status: "BCKLG",
      priority: "P1",
      workstream: "Security",
    },
    {
      seedId: "lk-back-google-login",
      title: "Google login",
      description:
        "OAuth via Google for admin users. Restrict to allow-listed workspace domains.",
      status: "BCKLG",
      priority: "P1",
      workstream: "Security",
      dependencies: ["lk-back-admin-users"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-back-org-mgmt",
      title: "Organization management",
      description:
        "Concept of an org owning multiple clients. Allows manager-scoped dashboards and per-org settings.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Future Platform",
    },
    {
      seedId: "lk-back-manager-dashboards",
      title: "Manager-scoped dashboards",
      description:
        "Limit dashboard view to clients the manager owns. Hide cross-tenant data unless admin.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Future Platform",
      dependencies: ["lk-back-org-mgmt"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-back-ghl-iframe",
      title: "GHL embedded onboarding iframe",
      description:
        "SA360 onboarding UI loaded inside GHL as an embedded app — same admin API, restricted scopes.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Future Platform",
    },
    {
      seedId: "lk-back-client-wizard",
      title: "Client self-serve setup wizard",
      description:
        "Guided flow for new clients to wire webhooks, calendars, and choose Voice/Meta options without operator help.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Onboarding",
    },
    {
      seedId: "lk-back-meta-roi",
      title: "Advanced Meta ROI dashboard",
      description:
        "Per-campaign ROI view fed by Meta CAPI signal lookups. Above and beyond minimum beta reporting.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Reporting",
    },
    {
      seedId: "lk-back-dialer",
      title: "Agent execution layer / Dial Buddy integration",
      description:
        "Wire dialer outbound + disposition logging back into SA360 lifecycle events.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Voice / Dialer",
    },
    {
      seedId: "lk-back-agent-scorecards",
      title: "Agent scorecards",
      description:
        "Per-agent performance view (calls, sets, shows, sales) feeding routing weights.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Reporting",
    },
    {
      seedId: "lk-back-weighted-routing",
      title: "Performance-weighted routing",
      description:
        "Bias routing toward higher-performing agents based on scorecards. Tunable per client.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Voice / Dialer",
      dependencies: ["lk-back-agent-scorecards"],
      dependencyCount: 1,
    },
    {
      seedId: "lk-back-replay-webhooks",
      title: "Replay failed webhook events",
      description:
        "Admin action to re-fire a failed lifecycle webhook from the request log. Useful for recovery + post-incident.",
      status: "BCKLG",
      priority: "P1",
      workstream: "Webhooks",
    },
    {
      seedId: "lk-back-alerting",
      title: "Slack or email alerting for critical failures",
      description:
        "On rising webhook failure rate, Synthflow error spikes, or Meta dispatch failures, page the on-call channel.",
      status: "BCKLG",
      priority: "P1",
      workstream: "Reporting",
    },
    {
      seedId: "lk-back-custom-domains",
      title: "Custom domains: admin.smartagent360.com and api.smartagent360.com",
      description:
        "Final production hostnames for both admin UI and API. Includes TLS, redirects, and DNS plumbing.",
      status: "BCKLG",
      priority: "P2",
      workstream: "Infra & Deploy",
    },
  ];
}

/** The canonical board this app seeds on first launch. */
export const LAUNCH_KANBAN_DEFAULT_BOARD_KEY = "sa360_beta_mvp_launch";
export const LAUNCH_KANBAN_DEFAULT_BOARD_NAME = "SA360 Beta MVP Launch";

# SA360 Canonical Registry

Status: first repo-authored registry draft, now aligned to SA360 Lead Fulfillment OS direction.

This folder is the canonical review point before adding SA360 fields, tags, workflows, custom values, Prisma models, API events, dashboard concepts, or Figma roadmap items.

Primary product direction: SA360 as a Lead Fulfillment OS (proof-backed lead supply, verification, inventory, ordering, fulfillment, and delivery audit).

## Source Of Truth

- Repo technical truth: API routes, Prisma models/enums, Zod schemas, admin endpoints, worker processors, event names, service logic, and database-owned concepts.
- GHL runtime truth: custom fields, tags, workflows, custom values, pipelines, calendars, forms, custom menu links, and snapshot assets. Live GHL inventory is still required.
- Figma roadmap/UX truth: visual and product intent only. Figma cards/pages do not authorize new fields, tags, workflows, or database models.
- Admin C.O.C. pages: UI concepts unless backed by API, DB, or GHL inventory.

## Decision Rules

- Current state belongs in a field.
- Historical occurrence belongs in an event row or event log.
- Workflow trigger-only state belongs in a minimal tag.
- Copy/message text belongs in a custom value.
- Platform configuration belongs in `ClientConfig`, env, or a future DB flag model unless a GHL workflow must read it.
- Visual roadmap items remain Figma/UI concepts until backend and GHL inventory confirm ownership.

## Product Boundary

- SA360 roadmap focuses on lead proof, verification/dedupe, inventory, buyer orders, fulfillment matching, and delivery audit visibility.
- GHL is an optional downstream delivery destination via fulfillment delivery adapter, not primary product identity.
- Lifecycle signal engine remains a core retained asset for audit, reporting, and outcomes.

## LF1 Proof Vault Foundation (Implemented)

- Purpose: attach a durable proof packet and consent proof snapshot to each lead UID for compliance review ready operations.
- Additive DB models now included: `LeadProof`, `ConsentDisclosureVersion`, `LeadSourceSnapshot`, `LeadVerificationResult`.
- Migration: `20260630163000_add_lf1_proof_vault_foundation`.
- Proof packet fields now normalized for storage: lead/source identifiers, source lane/platform/type, campaign/ad/form metadata, consent text/version/timestamp, privacy/terms versions, submitted timestamp, IP/user agent, phone/email, proof status, and missing proof reasons.
- Safe language in use: proof packet, consent proof, verification status, suppression check status, compliance review ready, proof required before sellable.
- Current status behavior is intentionally safe: `PROOF_ATTACHED`, `PROOF_MISSING`, `NEEDS_REVIEW`, or `UNREVIEWED` based on available proof context.
- Verification record is placeholder-only in this phase: verification status/suppression check status/duplicate status fields exist, but no external verification integrations are active yet.
- Non-blocking integration points:
  - `POST /webhooks/ghl/lifecycle-event` persists proof side effects after payload validation.
  - Source intake routing persist path persists proof after enrichment without blocking routing dry-run or duplicate checks.
- Admin overview route: `GET /admin/v1/coc/lead-fulfillment/overview` returns proof vault aggregates via `getLeadFulfillmentOverviewForAdmin()`.
- Admin C.O.C. `/lead-fulfillment` loads live proof vault data when the admin API is configured; falls back to mock overview data on fetch failure or missing config.
- Inventory, order, and delivery KPIs remain placeholders until LF3–LF5 modules are implemented.
- Intentionally not implemented yet: ConsentDisclosureVersion CRUD/admin UI, external verification vendors, inventory/order KPIs, dedicated fulfillment activity ledger, legal/compliance marketing claims.
- Non-goals in this phase: no live delivery behavior changes, no routing dry-run changes, no billing logic, no legal/compliance marketing claims.
- Legal note: compliance language and claims still require legal review before any external marketing copy.

## LF2 Fulfillment Shadow Core (Implemented — branch `feature/fulfillment-shadow-core-v1`)

- Purpose: durable channel-neutral shadow path from trusted source lead → eligibility → commercial allocation → planned delivery instructions.
- **`LeadOrder`** is the commercial demand source of truth; legacy rows keep nullable fulfillment fields and are not auto-activated by migration.
- **`LeadAllocation`** determines commercial ownership (source lead + order + tenant); GHL is not part of allocation.
- **`DeliveryTarget`** and **`DeliveryInstruction`** determine delivery planning only; GHL is one adapter via extensible `adapterKey` registry.
- Shadow allocation increments **`proposedQuantity` only**; it does not consume live `reservedQuantity` / `fulfilledQuantity` capacity.
- **`FulfillmentOutbox`** is durable and replay-safe with conditional claim + 15-minute stale-processing reclaim.
- Intake-to-outbox is **not yet fully transactional**; reconciliation backfills missing outbox rows without duplicate idempotency keys.
- Fully transactional intake/outbox insertion is required before broad automatic fulfillment.
- **`DeliveryAttempt`**, atomic reservation, and live adapter execution are explicitly deferred.
- Additive DB models: extended `LeadOrder` fulfillment fields, `LeadEligibilityAssessment`, `LeadAllocation`, `DeliveryTarget`, `DeliveryInstruction`, `FulfillmentOutbox`.
- Migration: `20260708180000_fulfillment_shadow_core_v1` (not auto-applied to shared environments).
- Admin inspection routes under `/admin/v1/fulfillment-shadow/*`; worker invokes internal process endpoint with `ADMIN_API_KEY`.
- ADR: `docs/adr/lf2-fulfillment-shadow-core.md`.

## LF2 Reservation and DeliveryAttempt Foundation (PR A — branch `feature/fulfillment-reservation-v1`)

- Purpose: atomic order reservation, provider-neutral `DeliveryAttempt` audit rows, simulation-only orchestration.
- **No live external writes in PR A.** `ghl.crm.v1` execution deferred to PR B.
- Allocation lifecycle: `shadow` → `reserved` → `delivering` → `committed` | `released` | `review_required`.
- Manual admin reservation only: `POST /admin/v1/fulfillment-execution/allocations/:allocationId/reserve`.
- Simulation endpoint: `POST /admin/v1/fulfillment-execution/instructions/:instructionId/simulate` (`test.simulated.v1` only).
- Migration: `20260709120000_lf2_reservation_enums_v1`, `20260709121000_lf2_reservation_delivery_attempt_v1`.
- ADR: `docs/adr/lf2-fulfillment-reservation-v1.md`.

## LF2 Guarded GHL Canary Delivery (PR B — branch `feature/fulfillment-ghl-canary-v1`)

- Purpose: manually guarded live GHL canary for LF2 reserved allocations via `ghl.crm.v1`.
- **Deny-by-default LF2 allowlists** (`SA360_LF2_*`) are required in addition to legacy runtime/readiness guards.
- Admin endpoints:
  - `GET /admin/v1/fulfillment-execution/instructions/:instructionId/ghl-live/canary/preflight`
  - `POST /admin/v1/fulfillment-execution/instructions/:instructionId/ghl-live/canary`
- Live attempts use `executionMode=live` and commit through PR A fulfillment outcome services.
- No automatic fulfillment worker in PR B.
- ADR: `docs/adr/lf2-fulfillment-ghl-canary-v1.md`.

## Legacy / Retainer Only

- Existing CRM support for current and retainer clients.
- Existing GHL workflow maintenance and operational fixes.
- Existing Synthflow support.
- Existing CloseBot support.
- Existing voice AI support.
- Existing client/retainer automations.

## Deprecated / Do Not Build (new roadmap)

- Blue/green channel selection expansion.
- SendBlue fallback optimization as a roadmap pillar.
- New Synthflow feature work.
- New CloseBot feature work.
- New voice AI routing/orchestration features.
- Orion-style front-end AI/CRM competition.
- Advanced channel selection as core differentiator.

## Files

- `sa360-fields.csv` - field-like repo, payload, DB, UI, config, and roadmap items.
- `sa360-tags.csv` - tag-like existing/proposed concepts using `SA360::NAMESPACE::VALUE`.
- `sa360-custom-values.csv` - message/config copy values and proposed naming.
- `sa360-workflows.csv` - workflow/module responsibility map.
- `sa360-events.csv` - event and signal registry.
- `sa360-db-models.csv` - Prisma model/enum registry.
- `sa360-api-routes.csv` - route registry.
- `sa360-admin-coc-ui-map.csv` - admin UI to API/DB support map.
- `sa360-figma-map.csv` - Figma/reference concepts mapped to actual objects.
- `sa360-conflicts.md` - conflicts, risks, and launch blockers.
- `sa360-ghl-inventory-needed.md` - paste-ready GHL export checklist.
- `sa360-do-not-create-list.md` - objects blocked until registry/GHL review.

## Current Registry Findings

- The repo already defines a durable lifecycle event ledger in `LifecycleEvent`; do not mirror event names into GHL custom fields.
- `InboundContactIndex` is the durable lookup surface for Synthflow known-caller and outbound context. GHL fields may stamp source state, but runtime lookups should not depend on tags.
- `WebhookRequestLog`, `SynthflowRequestLog`, and `SynthflowOutboundResultLog` are observability ledgers, not lifecycle fields.
- `ClientConfig` owns Meta configuration and client-level Meta sync state. Global and Synthflow flags are currently env-backed.
- Admin C.O.C. Command Center, Webhook Monitor, and Synthflow Voice have real `/admin/v1/coc/*` backing. Review Queue, Event Timeline, Clients, Client Detail, Flags, and Settings are partly or fully UI/stub concepts.
- Figma generated reference contains useful roadmap concepts and mock data, but it is explicitly visual/static reference, not runtime truth.

## Required Review Gate

Before creating anything in GHL, the proposed object must be checked in this order:

1. Does the repo already define it as DB, API, schema, event, or env/config?
2. Does live GHL inventory already contain it under another name?
3. Is it current state, historical event, trigger, copy, platform config, or visual concept?
4. Does creating it introduce multiple sources of truth?
5. Is it beta MVP required?

If any answer is unclear, mark it `needs_review` or `missing_inventory`; do not create it.

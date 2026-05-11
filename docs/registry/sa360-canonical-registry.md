# SA360 Canonical Registry

Status: first repo-authored registry draft.

This folder is the canonical review point before adding SA360 fields, tags, workflows, custom values, Prisma models, API events, dashboard concepts, or Figma roadmap items.

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

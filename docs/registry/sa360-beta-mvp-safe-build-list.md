# SA360 Beta MVP Safe Build List

This list identifies work that can proceed without creating duplicate GHL fields, tags, workflows, Prisma models, or API routes outside an approved implementation prompt.

Roadmap framing: SA360 Lead Fulfillment OS (proof-backed lead capture, verification/dedupe, inventory, orders, fulfillment, and delivery audit visibility).

## Safe Principles

- Build against existing GHL fields and workflows; do not create new GHL objects.
- Prefer read-only admin surfaces before write surfaces.
- Use repo logs and DB models for historical events and observability.
- Use GHL fields for current contact/workflow state.
- Treat tags as workflow triggers only, not state.
- Treat GHL as optional downstream fulfillment destination, not primary product identity.

## Lead Fulfillment OS Priority Order

1. Lead proof / consent packet.
2. Lead verification and dedupe.
3. Lead inventory queue.
4. Lead order / purchase platform.
5. Fulfillment matching.
6. Delivery audit and C.O.C. visibility.
7. Simple lead buyer dashboard for ordering and receiving leads.

## Legacy / Retainer Only

- Existing CRM workflow support.
- Existing GHL workflow maintenance.
- Existing Synthflow support.
- Existing CloseBot support.
- Existing voice AI support.
- Existing retainer client automations.

## Deprecated / Do Not Build (new roadmap)

- Blue/green channel selection expansion.
- SendBlue fallback optimization as a core initiative.
- New voice AI roadmap feature work.
- New Synthflow feature work.
- New CloseBot feature work.
- Orion-style front-end AI/CRM clone strategy.

## Safe Next Builds

| Build item | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| ReviewItem model/service design | Safe to design, implementation needs explicit prompt | SA360_DB | Medium | Define review item sources from `WebhookRequestLog`, `SynthflowRequestLog`, `MetaDispatchAttempt`, `FailedDispatch`, and GHL workflow errors. | yes |
| Review Queue read endpoints/UI | Safe after ReviewItem contract | SA360_DB + admin_coc | Medium | Build read-only queue first. Do not create GHL tags to represent review state. | yes |
| Client/Subaccount read endpoints | Safe | SA360_DB + GHL inventory | High | Add read-only `ClientConfig` and subaccount/location mapping endpoints when requested. Avoid write/update flows initially. | no |
| Client/Subaccount admin UI | Safe | admin_coc | High | Show existing config and inventory mappings. Mark unknown/missing mapping instead of creating fields. | no |
| Admin C.O.C. filters | Safe | repo/admin_coc | High | Extend filters for existing log fields: client, subaccount, event, status, lookup status, outcome, date range. | no |
| Admin C.O.C. detail drawers | Safe | repo/admin_coc | High | Expand detail drawers using existing redacted JSON and DB rows. Do not add replay/write actions yet. | no |
| Workflow action audit docs | Safe | manual_plan | High | Document each GHL workflow trigger, branch, field reads/writes, custom values, webhook calls, and message sends. | no |
| Payload mapping docs | Safe | repo/GHL | High | Map existing GHL fields to lifecycle payload keys and Synthflow payload keys. | no |
| GHL cleanup plan | Safe | manual_plan | High | Create cleanup tickets for duplicate/unclear fields without deleting anything yet. | yes |
| Secret migration plan | Safe | Security | High | Document current GHL secret custom values and desired backend/env target. Do not rotate until runtime path is confirmed. | yes |
| FeatureFlag design doc | Safe to design only | SA360_DB | Medium | Design flag hierarchy before model creation: env global gate, ClientConfig per-client gate, GHL display/request fields. | yes |
| Event Timeline design | Safe to design | SA360_DB + admin_coc | Medium | Map timeline rows to existing models; do not add event names until mapped. | yes |

## Existing GHL Fields Safe To Reference

| Field group | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| Identity: `sa360_client_account_id`, `sa360_lead_uid`, `sa360_phone_e164` | Keep/reference | GHL current payload input, repo mirror | High | Use for payload stamping and lookup. | no |
| Lifecycle: `sa360_lifecycle_stage`, `sa360_appointment_status`, `sa360_policy_status`, `sa360_routing_status` | Keep/reference | GHL | High | Use as current state fields. | no |
| Attribution: `sa360_source_platform`, `sa360_source_type`, `sa360_campaign_id`, `sa360_ad_id`, `sa360_fbclid`, `sa360_utm_*` | Keep/reference | GHL | High | Use for lifecycle payload attribution. | no |
| Agent ownership: `sa360_assigned_agent_id`, `sa360_assigned_agent_name` | Keep/reference | GHL | High | Use in payload ownership and Synthflow context. | no |
| Suppression: `sa360_dnc_flag`, `sa360_bad_number_flag`, `sa360_spam_flag` | Keep/reference with consent review | GHL | High | Use in routing/voice guardrails after aligning with native GHL DND. | yes |
| Calendars: `sa360_calendar_id`, `sa360_calendar_link`, `SA360_CAL_*`, `SA360_CAL_LINK_*` | Keep/reference | GHL | High | Use existing values; do not create more calendar config until calendar inventory is exported. | yes |
| Messages: existing `SA360_MSG_M2*` values | Keep/reference | GHL | Medium | Use only values referenced by published workflows. Audit `*_V2` before deprecating. | yes |

## Existing Workflows Safe To Reference

| Workflow | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `M1A - New Lead Intake - Veteran` | Keep/reference | GHL + repo lifecycle ingest | High | Verify webhook send action and payload body. | no |
| `M1B - Normalize and Lock Lead` | Keep/reference | GHL | High | Audit raw-to-normalized writes. | no |
| `M1C - Send Off` | Keep/reference | GHL | High | Audit backend sync/webhook action and ensure no duplicate sends. | yes |
| `M2A - First Contact Orchestrator` | Keep/reference | GHL | High | Audit routing into timing gate and first touch. | no |
| `M2A.5 - Immediate First Touch Watcher` | Keep/reference | GHL | High | Audit channel branches and diagram-only voice path. | yes |
| `M2A.FT-BLUE - First Touch Send` | Keep/reference | GHL | High | Audit message value and attempt count writes. | no |
| `M2A.FT-GREEN - First Touch Send` | Keep/reference if Green in beta | GHL | Maybe | Decide whether Green channel is beta MVP. | yes |
| `M2B - Timing Gate` | Keep/reference | GHL | High | Audit timezone/window conditions. | no |
| `M2C - Response + Daily Cadence` | Keep/reference | GHL | High | Audit reply detection and no-reply path. | no |
| `M2C-BLUE - Follow-Up Send` | Keep/reference | GHL | High | Audit messages and counters. | no |
| `M2C.4 - Appointment Booked` | Keep/reference | GHL | High | Audit appointment field writes and webhook payload. | no |
| `M2C.5 - Confirm and Remind` | Keep/reference | GHL | High | Audit reminder timing and messages. | no |
| `M2C.5 - Post-Gate Router` | Keep/reference | GHL | High | Audit branch priority and fallbacks. | no |
| `M2D - AI Handoff` | Keep/reference with AI field review | GHL | Medium | Confirm CloseBot/GHL AI ownership. | yes |

## Do Not Build Yet

| Build item | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| New GHL lifecycle fields | Block | GHL | High | Existing lifecycle fields are present. Use them. | no |
| New routing/status tags | Block | GHL | High | Use fields for current state. Tags only after explicit trigger need. | yes |
| Duplicate lead source fields | Block | GHL | High | Decide raw-vs-normalized source mapping. | yes |
| Meta config rewrites | Block | repo/GHL/Security | High | Decide Meta sync and secret source of truth first. | yes |
| Outbound voice production workflows | Block until audit | GHL + repo voice endpoints | Maybe | Audit M3 draft workflows, payloads, and custom values. | yes |
| New message custom values | Block | GHL | Medium | Audit existing `SA360_MSG_*` references and versioned values first. | yes |
| Replay endpoints/actions | Block | repo/admin_coc | Low | Design auth, idempotency, and audit trail first. | yes |
| `policy_issued` event | Block | repo/GHL | Maybe | Decide whether it is a new event or `policy_status=issued`. | yes |

## Recommended Beta Build Order

1. Workflow action audit docs for published M1/M2 workflows.
2. Lifecycle payload mapping doc from existing GHL fields to repo schema.
3. Read-only Client/Subaccount admin view.
4. ReviewItem schema design and review queue read model.
5. Admin C.O.C. filters/detail drawer improvements.
6. FeatureFlag design only, after Meta/client/channel flag ownership is decided.

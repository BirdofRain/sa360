# SA360 Registry Decision Matrix

Status: decision layer created after GHL screenshot reconciliation.

This document turns the registry into build decisions. It does not authorize creating new GHL objects. Use it before adding more GHL logic.

## Decision Rules

- Keep: existing object is canonical or safe to reference.
- Merge: two or more objects represent the same fact; pick one canonical owner.
- Rename: existing object can remain, but naming should be aligned or aliased.
- Deprecate: stop using after migration; do not delete until workflow references are audited.
- Review: human decision required before build.
- Block: do not build/create until upstream ownership is decided.

## Raw Vs Normalized Field Mapping

| Item | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `Lead Status` vs `sa360_lead_status` | Review then merge/alias | GHL | High | Decide whether native `Lead Status` is raw CRM status and `sa360_lead_status` is SA360 automation status. If not distinct, use `sa360_lead_status` for SA360 logic and deprecate workflow reads from native `Lead Status`. | yes |
| `Lead Type` vs `sa360_lead_type` vs `sa360_lead_type_normalized` | Review | GHL | High | Define `Lead Type` as raw/native display, `sa360_lead_type` as controlled routing value, and `sa360_lead_type_normalized` as normalization output only if both are actively used. Otherwise merge to one controlled SA360 field. | yes |
| `Contact source` vs `sa360_source_type` / `sa360_source_platform` / `sa360_first_touch_source` | Review and document aliases | GHL for raw source, repo payload for normalized attribution | High | Keep native `Contact source` as raw GHL source. Use `sa360_source_platform` and `sa360_source_type` for payload attribution. Use `sa360_first_touch_source` only for first-touch display/history. | yes |
| Raw niche webform fields vs normalized SA360 fields | Keep raw, map to normalized | GHL | Medium | Keep raw webform fields in GHL. Do not send all raw webform fields to lifecycle payload. Map only approved normalized outputs into `sa360_lead_type`, `sa360_niche_label`, attribution, and routing fields. | no |
| Native `State` vs `sa360_state_normalized` | Review | GHL | Medium | Treat native `State` as contact raw/current address. Use `sa360_state_normalized` only if normalization is needed for routing/timezone. | yes |
| Native `Timezone` vs `sa360_timezone` | Review | GHL | Medium | Treat native `Timezone` as GHL contact timezone and `sa360_timezone` as SA360 normalized value only if workflow logic needs it. Otherwise deprecate one. | yes |
| `sa360_phone_e164` vs native phone | Keep both with clear roles | GHL + repo payload | High | Native phone remains GHL contact field. `sa360_phone_e164` is normalized automation/payload value. Do not add more phone truth fields. | no |
| `sa360_phone_digits` / duplicate phone keys | Keep as fallback only | GHL | Medium | Use `sa360_phone_digits` only as normalization fallback and duplicate detection input. Canonical lookup remains `sa360_phone_e164`. | no |
| `Queue State` vs `sa360_routing_status` vs future `ReviewItem.status` | Review and likely deprecate `Queue State` | GHL now, future DB for ReviewItem | Medium | If `Queue State` is only review triage, move that meaning to future `ReviewItem`. Keep `sa360_routing_status` for contact routing state. | yes |
| `Disposition Outcome` vs `sa360_agent_disposition` / `sa360_voice_last_disposition` | Review and merge | GHL | Medium | Use `sa360_agent_disposition` for agent/current disposition. Use `sa360_voice_last_disposition` only for last voice call result. Deprecate generic `Disposition Outcome` if redundant. | yes |

## Canonical Current-State Fields

| Item | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `sa360_lifecycle_stage` | Keep | GHL current state, repo payload mirror | High | Use as canonical current lifecycle stage. Do not create lifecycle tags. | no |
| `sa360_appointment_status` | Keep | GHL current state, repo payload mirror | High | Use as canonical appointment current state. Use `appointment_set` only as event. | no |
| `sa360_policy_status` | Keep | GHL current state, repo payload mirror | High | Use as canonical policy current state. Decide separately whether `policy_issued` becomes an event. | no |
| `sa360_routing_status` | Keep | GHL current state, repo payload mirror | High | Use for active routing state. Do not duplicate with routing tags. | no |
| `sa360_ai_status` | Review duplicate folder placement | GHL | Medium | Confirm whether screenshot shows one field in two folders or two duplicate fields. Keep one canonical `sa360_ai_status`. | yes |
| `sa360_dead_lead_flag` | Keep | GHL current state, repo payload mirror | Medium | Use as suppression/current-state flag. Do not create dead-lead tags as truth. | no |
| `sa360_dnc_flag` / `sa360_bad_number_flag` / `sa360_spam_flag` | Keep with consent review | GHL | High | Keep as suppression fields, but align `sa360_dnc_flag` with native GHL DND/consent behavior. | yes |

## Meta Sync Source Of Truth

Recommended dispatch behavior owner: repo backend config, with `ClientConfig.metaSyncEnabled` as per-client source of truth and `META_SYNC_ENABLED` as global emergency/env gate.

| Item | Classification | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|---|
| `ClientConfig.metaSyncEnabled` | Actual per-client dispatch behavior | Keep as canonical per-client gate | SA360_DB | High | Treat as the durable client-level switch once admin/client config exists. | no |
| `META_SYNC_ENABLED` env | Actual global dispatch behavior | Keep as global emergency gate | repo/env | High | Use for deployment-wide off switch only, not per-client state. | no |
| `SA360_ENABLE_META_SYNC` custom value | GHL workflow config/request | Review | GHL | Medium | Use only if GHL workflow needs to decide whether to send lifecycle payloads or set `send_to_meta`. It should not override backend dispatch. | yes |
| `sa360_meta_sync_enabled` field | GHL display/request field | Review | GHL | Medium | Use as display/request mirror only unless GHL must gate webhook sends. Sync direction must be defined before relying on it. | yes |
| `sa360_dispatch_enabled` custom value | GHL config alias | Deprecate or alias | GHL | Medium | Merge meaning into `SA360_ENABLE_META_SYNC` or remove from workflow logic after audit. | yes |
| `event.send_to_meta` payload field | Per-event dispatch request | Keep | repo payload contract | High | GHL can set false for a specific event, but backend still applies global/per-client gates. | no |
| `MetaDispatchAttempt` | Historical result | Keep | SA360_DB | High | Use for audit/reporting only. Never use as current config. | no |
| Future `FeatureFlag` model | Config/admin override | Review | SA360_DB | Medium | Build only if mapped to `ClientConfig` and env gates without adding a third active source of truth. | yes |

## Secrets And Tokens

| Item | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `SA360_SYNTHFLOW_API_KEY` custom value | Keep temporarily, move later | GHL now, backend/env later | High | Do not duplicate. Do not expose in UI. Plan migration to backend/env/secrets manager and rotate after migration. | yes |
| `SA360_WEBHOOK_SECRET` custom value | Keep temporarily, move later | GHL now, repo/env runtime | High | Do not expose. Ensure value matches backend `WEBHOOK_SECRET`. Plan rotation and secret storage cleanup. | yes |
| `SA360_TOKEN_FEX` / `SA360_TOKEN_HEALTH` / `SA360_TOKEN_IUL` / `SA360_TOKEN_MTG` / `SA360_TOKEN_NURSE` / `SA360_TOKEN_VET` | Keep temporarily, move later | GHL now, backend/env or DB secret store later | High | Treat as sensitive redacted. Do not create more token custom values. Move to backend-owned secret storage before scaling. | yes |
| `metaAccessToken` in `ClientConfig` | Keep backend-owned | SA360_DB | High | Use as eventual dispatch token owner. Ensure admin UI never displays values. | no |
| `ADMIN_API_KEY` / `SA360_ADMIN_API_KEY` | Keep env-only | repo/env | High | Never create GHL custom values. Never expose in UI. | no |
| `SA360_LOOKUP_CALLER_WEBHOOK_URL` / `SA360_WEBHOOK_URL` | Keep but review URL exposure | GHL | Medium | URLs are not secrets by themselves, but redact query params/tokens. Confirm workflow references before renaming. | yes |
| `SA360_SYNTHFLOW_MODEL` / `SA360_SYNTHFLOW_MODEL_ID_VET` | Review sensitivity | GHL | Medium | Treat model IDs as config. Redact if vendor considers sensitive. Map to voice workflow fields before use. | yes |

## Workflow Beta Decisions

| Workflow | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `M1A - New Lead Intake - Veteran` | Keep | GHL sends, repo stores | High | Confirm it sends exactly one lifecycle webhook path and stamps required payload fields. | no |
| `M1B - Normalize and Lock Lead` | Keep | GHL | High | Audit field writes, especially raw-to-normalized mappings and duplicate keys. | no |
| `M1C - Send Off` | Keep | GHL | High | Confirm it is the handoff to M2/backend sync and does not duplicate M1A webhook sends. | yes |
| `M2A - First Contact Orchestrator` | Keep | GHL | High | Audit branches for first-touch path and timing gate entry. | no |
| `M2A.5 - Immediate First Touch Watcher` | Keep | GHL | High | Confirm BLUE/GREEN/VOICE branches and missing `M2FT-VOICE` handling. | yes |
| `M2A.FT-BLUE - First Touch Send` | Keep | GHL | High | Safe to reference. Audit message values used and fields written. | no |
| `M2A.FT-GREEN - First Touch Send` | Keep | GHL | Medium | Safe if Green channel is beta. Otherwise keep but do not depend on it for beta. | yes |
| `M2B - Timing Gate` | Keep | GHL | High | Audit allowed-window conditions and timezone fields. | no |
| `M2C - Response + Daily Cadence` | Keep | GHL | High | Audit reply detection and day limit logic. | no |
| `M2C-BLUE - Follow-Up Send` | Keep | GHL | High | Safe to reference for Blue cadence. | no |
| `M2C-GREEN - Follow-Up Send` | Review | GHL | Maybe | Draft; decide if Green is beta MVP. Publish only after action audit. | yes |
| `M2C-GUARD_TEMPLATE` | Do not use as runtime | GHL | No | Keep as internal template. Do not route production contacts into it. | no |
| `M2C.4 - Appointment Booked` | Keep | GHL | High | Audit mapping to `appointment_set`, `sa360_appointment_status`, and calendar fields. | no |
| `M2C.5 - Confirm and Remind` | Keep | GHL | High | Audit reminder timing and message custom values. | no |
| `M2C.5 - Post-Gate Router` | Keep | GHL | High | Audit branch order: booked, channel, voice review, fallback. | no |
| `M2D - AI Handoff` | Keep with field review | GHL | Medium | Confirm AI fields and CloseBot/GHL AI control source of truth. | yes |
| `M2E - Fallback / No Reply` | Review before beta | GHL | Maybe | Draft; decide whether beta requires terminal no-reply path. If yes, publish after audit or implement ReviewItem fallback. | yes |
| `M3V-A - Call New Lead` | Review before production | GHL | Maybe | Draft; do not rely on production voice initiation until outbound call URL/model/agent phone custom values are confirmed. | yes |
| `M3V-B - Post Call Processing` | Review before production | GHL + repo outbound result endpoint | Maybe | Draft; map inbound post-call payload to `/voice/synthflow/outbound-result`. | yes |
| `M3V-C - Voice Re-Engage` | Review before production | GHL | Maybe | Draft; define retry limits and relation to `sa360_voice_next_retry_at`. | yes |
| `M3V-D` | Missing inventory | unknown | Maybe | Confirm whether real workflow exists or only diagram branch. Do not create until verified. | yes |
| `M2FT-VOICE` | Diagram-only | GHL/manual plan | Maybe | Confirm desired path. Could be Review Queue item instead of workflow. | yes |

## Build Decisions

| Item | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| ReviewItem model/service | Safe to design/build after schema review | SA360_DB | Medium | Build DB/API around logs and workflow errors, not GHL tags. | yes |
| Review Queue endpoints/UI | Safe to build after ReviewItem contract | SA360_DB + admin_coc | Medium | Use `WebhookRequestLog`, `SynthflowRequestLog`, `MetaDispatchAttempt`, and future `ReviewItem`. | yes |
| Client/Subaccount read endpoints/UI | Safe to build read-only | SA360_DB + GHL inventory | High | Expose `ClientConfig` and mapped subaccount/location labels. Avoid writes until source mapping is approved. | no |
| FeatureFlag model | Review carefully | SA360_DB | Medium | Build only if it maps existing GHL client flags and env gates without adding active duplicates. | yes |
| Admin C.O.C. filters/detail drawers | Safe | repo/admin_coc | High | Improve read-only observability using existing logs and models. | no |
| Workflow action audit docs | Safe | manual_plan | High | Document triggers, conditions, reads/writes, webhooks, and custom values before new logic. | no |
| New GHL lifecycle fields | Block | GHL | High | Do not create; existing fields cover canonical lifecycle state. | no |
| New routing/status tags | Block | GHL | High | Do not create tag equivalents for existing state fields. | no |
| Duplicate lead source fields | Block | GHL | High | Resolve raw-vs-normalized source mapping first. | yes |
| Meta config rewrites | Block | repo/GHL | High | Decide source of truth and secret migration path first. | yes |
| Outbound voice workflows | Block for production | GHL + repo voice endpoints | Maybe | Audit draft workflows and payload mapping before publishing or building against them. | yes |
| New message custom values | Block | GHL | Medium | Audit existing `SA360_MSG_*` workflow references first. | yes |

# SA360 GHL Cleanup Actions

This is a cleanup plan, not an execution plan. Do not delete, rename, or create live GHL objects until workflow references are audited and a human approves the action.

## Cleanup Status Keys

- Keep: safe existing object.
- Rename/Alias: align naming while preserving old references until workflows are migrated.
- Merge: consolidate meaning after workflow references are known.
- Deprecate: stop using after migration.
- Review: needs human decision.
- Block: do not create duplicates.

## Field Cleanup Actions

| Object(s) | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `sa360_lifecycle_stage` | Keep | GHL | High | Freeze as canonical lifecycle current-state field. Audit dropdown options. | no |
| `sa360_appointment_status` | Keep | GHL | High | Freeze as canonical appointment current-state field. Audit dropdown options. | no |
| `sa360_policy_status` | Keep | GHL | High | Freeze as canonical policy current-state field. Audit dropdown options. | no |
| `sa360_routing_status` | Keep | GHL | High | Freeze as canonical routing current-state field. Audit dropdown options. | no |
| `sa360_ai_status` duplicate folder placement | Review | GHL | Medium | Confirm whether this is one field displayed in two folders or two separate fields. Deprecate duplicate if real. | yes |
| `Lead Status` + `sa360_lead_status` | Merge/alias after review | GHL | High | Audit all workflow reads/writes. Choose canonical SA360 workflow status and document native field role. | yes |
| `Lead Type` + `sa360_lead_type` + `sa360_lead_type_normalized` | Review and likely merge | GHL | High | Decide raw/native vs controlled/normalized. Update docs before any workflow edits. | yes |
| `Contact source` + `sa360_source_platform` + `sa360_source_type` + `sa360_first_touch_source` + `sa360_origin_channel` | Review and map | GHL + repo payload | High | Document source taxonomy and payload mapping. Avoid new source fields. | yes |
| `Queue State` | Deprecate candidate | GHL now, future DB if ReviewItem | Medium | If used for review queue only, migrate meaning to future `ReviewItem.status`. | yes |
| `Disposition Outcome` | Merge candidate | GHL | Medium | Merge into `sa360_agent_disposition` or `sa360_voice_last_disposition` after workflow audit. | yes |
| `sa360_subaccount_id` custom value | Rename/alias candidate | GHL | High | Map to canonical payload `subaccount_id_ghl`. Do not rename until all webhook actions are checked. | yes |
| `sa360_calendar_id` / `sa360_calendar_link` + `SA360_CAL_*` / `SA360_CAL_LINK_*` | Keep, map roles | GHL | High | Decide field vs custom value roles: contact-specific selected calendar vs reusable niche calendar config. | yes |
| `sa360_voice_attempt_count` + `sa360_contact_attempt_count` + channel attempt counts | Review | GHL | Medium | Define whether counters are total attempts, voice attempts, or per-channel attempts. | yes |
| `sa360_voice_last_disposition` + outbound `outcome` + `sa360_agent_disposition` | Review | GHL + repo logs | Medium | Use GHL fields for latest/current display; repo logs remain historical call results. | yes |
| Raw webform fields | Keep raw | GHL | Low | Do not normalize in place. Map only selected fields into SA360 normalized fields. | no |

## Custom Value Cleanup Actions

| Object(s) | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `SA360_MSG_M2*` values | Keep | GHL | Medium | Audit which values are referenced by published workflows. Do not create new message values. | yes |
| `*_V2` message values | Deprecate candidate | GHL | Medium | Identify active workflow references. Deprecate unused older versions only after copy approval. | yes |
| `SA360_CAL_*` and `SA360_CAL_LINK_*` | Keep | GHL | High | Export exact calendar IDs/links and map to calendar inventory. | no |
| `SA360_PIPELINE_*` and `SA360_STAGE_*` | Keep | GHL | High | Export pipeline/stage IDs and map to event/status fields. | no |
| `SA360_DATASET_*` and `SA360_DATASET_NAME_*` | Review | GHL + repo Meta config | High | Decide whether GHL supplies dataset IDs in payload or backend owns via `ClientConfig`. | yes |
| `SA360_ENABLE_META_SYNC` + `sa360_dispatch_enabled` | Merge/alias candidate | GHL | High | Pick one GHL-side request/display value if needed. Backend dispatch still uses repo gates. | yes |
| `SA360_CLIENT_ACCOUNT_ID` | Keep but avoid duplicate truth | GHL | High | Use for GHL workflow config only; contact-level field remains `sa360_client_account_id`. | no |
| `sa360_subaccount_id` | Rename/alias candidate | GHL | High | Map to `subaccount_id_ghl`; do not add a new duplicate custom value. | yes |
| `SA360_SYNTHFLOW_API_KEY` | Move later, rotate | Security | High | Keep temporarily. Move to backend/env or secret manager, then rotate. Do not expose in UI. | yes |
| `SA360_WEBHOOK_SECRET` | Move later, rotate | Security | High | Keep temporarily if GHL needs it for webhook header. Ensure no UI exposure. Rotate after migration. | yes |
| `SA360_TOKEN_*` | Move later, rotate | Security | High | Treat as sensitive. Move Meta tokens to backend secret storage or `ClientConfig`-managed secure path. | yes |
| `SA360_LOOKUP_CALLER_WEBHOOK_URL` / `SA360_WEBHOOK_URL` | Keep with URL review | GHL | Medium | Confirm no secret query params. Keep as config URLs if workflows need them. | yes |

## Workflow Cleanup Actions

| Workflow | Decision | Owner source of truth | Beta MVP impact | Recommended next action | Human decision needed |
|---|---|---|---|---|---|
| `M1A - New Lead Intake - Veteran` | Keep | GHL | High | Confirm triggers, payload, and whether it calls backend directly. | no |
| `M1B - Normalize and Lock Lead` | Keep | GHL | High | Document every field write, especially normalized fields. | no |
| `M1C - Send Off` | Keep with audit | GHL | High | Confirm it does not duplicate M1A webhook send. | yes |
| `M2A - First Contact Orchestrator` | Keep | GHL | High | Confirm branch criteria and field writes. | no |
| `M2A.5 - Immediate First Touch Watcher` | Keep with audit | GHL | High | Resolve diagram-only `M2FT-VOICE` path. | yes |
| `M2C-GREEN - Follow-Up Send` | Keep draft, review beta need | GHL | Maybe | If Green is beta, complete/publish after audit. If not, leave draft. | yes |
| `M2C-GUARD_TEMPLATE` | Keep as template only | GHL | No | Do not enroll production contacts. | no |
| `M2E - Fallback / No Reply` | Review | GHL | Maybe | Decide whether beta requires fallback/no-reply terminal handling. | yes |
| `M3V-A/B/C` | Keep draft, block production reliance | GHL | Maybe | Audit Synthflow custom values and payloads before publishing. | yes |
| `M3V-D` | Missing inventory | unknown | Maybe | Confirm existence. Do not create until verified. | yes |
| `M2FT-VOICE` | Diagram-only | GHL/manual plan | Maybe | Decide whether to implement as workflow or Review Queue path. | yes |

## Tag Cleanup Actions

No live GHL tag inventory was provided in this screenshot chunk. Until tags are exported:

- Do not create lifecycle/status/routing/channel/AI tags.
- Do not create tags equivalent to existing fields.
- Allow tags only as temporary workflow triggers after documenting why a field cannot be used.

## Cleanup Order

1. Export exact workflow actions for published M1/M2 workflows.
2. Export exact field IDs/options for duplicate-risk fields.
3. Decide raw-vs-normalized mapping for lead status, lead type, and source.
4. Decide Meta sync and secret ownership.
5. Confirm draft workflow beta requirements.
6. Only then rename, merge, or deprecate live GHL objects.

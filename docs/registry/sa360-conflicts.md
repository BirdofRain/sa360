# SA360 Registry Conflict Report

This report is documentation-only. It flags objects that should not be created or expanded until repo, GHL, admin C.O.C., and Figma ownership are reconciled.

## Conflicts And Risks

### 1. Lifecycle Stage vs Lead Status vs Tags

- Severity: high
- Affected sources: `packages/shared/src/types.ts`, `apps/api/src/schemas/lifecycle-event.schema.ts`, `prisma/schema.prisma`, Figma mock events/tags
- Why it matters: `lifecycle_stage` is current state; events like `lead_created`, `first_response`, and `appointment_set` are historical. Tags such as `SA360::M1::LEAD_CREATED` would duplicate the event ledger and confuse routing.
- Recommended action: keep `lifecycle_stage` as the controlled current-state field and keep lifecycle event names in `LifecycleEvent`.
- Human decision needed: yes

### 2. Appointment Status vs Appointment Event Tags

- Severity: high
- Affected sources: `packages/shared/src/types.ts`, `apps/api/src/services/synthflow-outbound-context.service.ts`, `packages/shared/src/event-map.ts`
- Why it matters: `appointment_status` drives voice guardrails while `appointment_set` and `appointment_showed` are event names. Appointment status tags would create a second source of truth.
- Recommended action: inventory GHL appointment fields/stages and define one controlled `appointment_status` field; do not create status tags.
- Human decision needed: yes

### 3. Policy Status vs Sale/Policy Events

- Severity: high
- Affected sources: `packages/shared/src/types.ts`, `packages/shared/src/event-map.ts`, `docs/figma/generated-reference/internal-admin-dashboard/src/app/components/data.ts`
- Why it matters: `policy_status` is current state; `sale_logged` is an event. `policy_issued` is requested but not supported by `InternalEventName`.
- Recommended action: keep `sale_logged` in event ledger; decide whether `policy_issued` should be added to shared types before any GHL workflow creation.
- Human decision needed: yes

### 4. Known Caller As Field/Tag

- Severity: high
- Affected sources: `apps/api/src/services/synthflow-inbound-lookup.service.ts`, `prisma/schema.prisma`, `apps/api/src/services/admin-metrics.service.ts`
- Why it matters: `known_caller` is a per-request Synthflow response/log signal. Persisting it as a GHL contact field or tag would quickly become stale.
- Recommended action: keep `knownCaller` in `SynthflowRequestLog`; create review events for repeated unknown callers only after Review Queue design.
- Human decision needed: no

### 5. Outbound Guardrails As Durable Fields

- Severity: medium
- Affected sources: `apps/api/src/services/synthflow-outbound-context.service.ts`
- Why it matters: `booking_allowed`, `reschedule_allowed`, `has_active_appointment`, `do_not_book_reason`, and `script_goal` are derived response variables, not canonical contact state.
- Recommended action: keep these response-only unless a future prompt/config registry explicitly needs custom values.
- Human decision needed: yes

### 6. Feature Flags Naming Mismatch

- Severity: medium
- Affected sources: `apps/admin-coc/src/app/(dashboard)/flags/page.tsx`, `apps/api/src/lib/synthflow-voice-env.ts`, `apps/api/src/lib/meta-sync-enabled.ts`, `docs/figma/generated-reference/internal-admin-dashboard/src/app/components/data.ts`
- Why it matters: UI/Figma references `VOICE_ENABLED`, `BLUE_ENABLED`, `GREEN_ENABLED`, and `CLOSEBOT_ENABLED`, while repo runtime uses `SYNTHFLOW_INBOUND_ENABLED`, `SYNTHFLOW_OUTBOUND_CONTEXT_ENABLED`, and `META_SYNC_ENABLED`.
- Recommended action: treat BLUE/GREEN/CLOSEBOT/VOICE as roadmap labels until a FeatureFlag model or env contract is approved.
- Human decision needed: yes

### 7. Meta Config In Payload vs ClientConfig

- Severity: high
- Affected sources: `packages/shared/src/types.ts`, `prisma/schema.prisma`, `apps/worker/src/processors/meta-dispatch.processor.ts`
- Why it matters: lifecycle payloads may include `meta_dataset_id` and routing dataset IDs, while `ClientConfig` stores `metaDatasetId` and `metaAccessToken`. Duplicating these in GHL custom values risks wrong Meta dispatch.
- Recommended action: keep secrets/config in DB/env; only allow payload dataset overrides after GHL inventory confirms expected source.
- Human decision needed: yes

### 8. Client/Subaccount Naming Drift

- Severity: medium
- Affected sources: `client_account_id`, `clientAccountId`, `subaccount_id_ghl`, `subaccountIdGhl`, Figma `ghlLocationId`
- Why it matters: the same concepts appear in snake_case payloads, camelCase DB/API/admin fields, and Figma `ghlLocationId`.
- Recommended action: document aliases and choose one GHL custom field/display name for account mapping after inventory.
- Human decision needed: yes

### 9. Review Queue Has No Backend Model

- Severity: medium
- Affected sources: `apps/admin-coc/src/app/(dashboard)/review/page.tsx`, `docs/figma/generated-reference/internal-admin-dashboard/src/app/components/data.ts`
- Why it matters: `ReviewItem` is mentioned in UI and Figma but not present in Prisma or API routes. Creating GHL tags to simulate review items would be the wrong source of truth.
- Recommended action: keep as UI concept; design `ReviewItem` DB/API only after registry review.
- Human decision needed: yes

### 10. Event Timeline Has No Aggregation API

- Severity: medium
- Affected sources: `apps/admin-coc/src/app/(dashboard)/timeline/page.tsx`, generated Figma timeline data
- Why it matters: timeline mocks combine lifecycle, attribution, contact indexing, Synthflow lookup, Meta dispatch, and review events, but no API joins them.
- Recommended action: map timeline event types to existing models before adding UI filters or GHL artifacts.
- Human decision needed: yes

### 11. GHL Custom Values vs API Response Logic

- Severity: medium
- Affected sources: `apps/api/src/routes/voice.ts`, `apps/api/src/services/synthflow-outbound-context.service.ts`
- Why it matters: API guardrail response text and computed voice variables could be accidentally duplicated as `SA360_MSG_*` values.
- Recommended action: only create custom values for reusable copy/templates; do not create values for computed booleans or API status text.
- Human decision needed: yes

### 12. Policy Issued Is Requested But Unsupported

- Severity: medium
- Affected sources: user registry requirements, `packages/shared/src/types.ts`, `packages/shared/src/event-map.ts`
- Why it matters: `policy_issued` is requested as a signal concept but absent from `InternalEventName` and Meta event map.
- Recommended action: mark missing inventory until product decides whether it is `sale_logged`, `policy_status=issued`, or a new event.
- Human decision needed: yes

### 13. M2FT-BLUE / M2FT-GREEN Are Roadmap Only

- Severity: medium
- Affected sources: user registry requirements, Figma mock flags
- Why it matters: no repo routes, DB model, env vars, or GHL inventory define these workflows.
- Recommended action: keep as Launch roadmap concepts; do not create workflows/tags/fields until spec and GHL inventory exist.
- Human decision needed: yes

### 14. Debug/Test Routes Could Be Mistaken For Product Routes

- Severity: low
- Affected sources: `apps/api/src/routes/webhook.ts`, `apps/api/src/routes/debug-logtail.ts`
- Why it matters: `/debug/test-event`, `/webhooks/ghl/test`, and `/debug/logtail-test` are useful for development but should not drive registry objects.
- Recommended action: keep them in API route registry as non-MVP/debug routes.
- Human decision needed: no

### 15. `WebhookRequestSource` Naming May Lag New Voice Routes

- Severity: low
- Affected sources: `prisma/schema.prisma`, `apps/api/src/services/synthflow-request-log.service.ts`, admin filters
- Why it matters: enum includes `synthflow_inbound_lookup`, while `SynthflowRequestLog` is now also used for outbound context with a string source.
- Recommended action: review source naming before adding more Synthflow request types or admin filters.
- Human decision needed: yes

## GHL Screenshot Reconciliation - 2026-05-08

Source: `ghl_screenshot_inventory_2026_05_08`.

### Exact Duplicates Found

- `sa360_lifecycle_stage` maps directly to payload `lifecycle_stage` and DB/index `lifecycleStage`.
- `sa360_appointment_status` maps directly to payload `appointment_status` and DB/index `appointmentStatus`.
- `sa360_policy_status` maps directly to payload `policy_status` and DB/index `policyStatus`.
- `sa360_agent_disposition` maps directly to payload `agent_disposition`.
- `sa360_routing_status` maps directly to payload `routing_status`.
- `sa360_ai_status` maps directly to payload `ai_status`, but appears in two GHL folders.
- `sa360_dead_lead_flag` maps directly to payload `dead_lead_flag`.
- `sa360_client_account_id` maps directly to payload `client_account_id` and DB `clientAccountId`.
- `sa360_lead_uid` maps directly to payload `lead_uid` and DB `leadUid`.
- `sa360_phone_e164` maps directly to payload `phone_e164` and DB `phoneE164`.
- `sa360_phone_digits` maps directly to payload fallback `phone_digits`.
- `sa360_source_platform`, `sa360_source_type`, `sa360_campaign_id`, `sa360_campaign_name`, `sa360_ad_id`, `sa360_ad_name`, `sa360_adset_id`, `sa360_adset_name`, `sa360_fbclid`, and `sa360_utm_*` map directly to lifecycle attribution payload fields.
- `sa360_meta_pixel_id`, `sa360_meta_dataset_id`, `sa360_source_dataset_id`, `sa360_source_dataset_name`, `sa360_master_dataset_id`, and `sa360_master_dataset_name` map directly to lifecycle Meta/routing fields.
- `sa360_assigned_agent_id` and `sa360_assigned_agent_name` map directly to ownership payload fields.

### Likely Duplicates With Different Names

- Native `Lead Status` and SA360 `sa360_lead_status` need a raw/native vs SA360-controlled mapping.
- Native `Lead Type`, `sa360_lead_type`, and `sa360_lead_type_normalized` need a raw vs normalized mapping.
- Native `Contact source`, `sa360_source_platform`, `sa360_source_type`, `sa360_first_touch_source`, and `sa360_origin_channel` overlap.
- Native `Timezone` and SA360 `sa360_timezone` overlap unless the SA360 field is explicitly normalized/enriched.
- Native `State` and `sa360_state_normalized` overlap unless raw vs normalized semantics are documented.
- `sa360_appointment_booked_at`, `sa360_appointment_set_at`, and outbound `appointment_time` overlap.
- `sa360_voice_attempt_count`, `sa360_contact_attempt_count`, `sa360_blue_attempt_count`, and `sa360_green_attempt_count` are related counters that need clear counting scope.
- `sa360_voice_last_disposition`, `Disposition Outcome`, outbound `outcome`, and `sa360_agent_disposition` overlap.
- `sa360_voice_last_summary`, `sa360_voice_last_transcript_url`, and `transcript_summary` overlap but may intentionally separate summary vs artifact URL.
- `sa360_meta_sync_enabled`, custom value `SA360_ENABLE_META_SYNC`, custom value `sa360_dispatch_enabled`, env `META_SYNC_ENABLED`, and `ClientConfig.metaSyncEnabled` are multiple gates for Meta dispatch.
- `sa360_calendar_id`, `sa360_calendar_link`, `SA360_CAL_*`, `SA360_CAL_LINK_*`, and `SYNTHFLOW_OUTBOUND_CALENDAR_MAP_JSON` overlap as calendar configuration.
- `sa360_agent_blue_number`, `sa360_agent_green_number`, `SA360_AGENT_BLUE_NUMBER`, and `SA360_AGENT_GREEN_NUMBER` overlap.
- `sa360_client_voice_enabled`, `sa360_voice_enabled`, `sa360_agent_voice_enabled`, and backend `SYNTHFLOW_*` flags overlap at client/contact/agent/runtime levels.
- `sa360_client_closebot_enabled` now exists in GHL, but repo has no corresponding runtime flag/model.
- `sa360_client_blue_enabled` and `sa360_client_green_enabled` now exist in GHL, while repo has no `BLUE_ENABLED`/`GREEN_ENABLED` runtime gate.

### Safe Existing Objects

- SA360-controlled lifecycle fields are safe to use as GHL runtime truth when mapped to payload keys: `sa360_lifecycle_stage`, `sa360_appointment_status`, `sa360_policy_status`, `sa360_routing_status`, `sa360_agent_disposition`, `sa360_ai_status`, `sa360_dead_lead_flag`.
- SA360 identity and attribution fields are safe to use if copied exactly into lifecycle payloads: `sa360_client_account_id`, `sa360_lead_uid`, `sa360_phone_e164`, `sa360_source_platform`, `sa360_source_type`, `sa360_campaign_id`, `sa360_ad_id`, `sa360_fbclid`, and `sa360_utm_*`.
- Published GHL workflows `M1A`, `M1B`, `M1C`, `M2A`, `M2A.5`, `M2A.FT-BLUE`, `M2A.FT-GREEN`, `M2B`, `M2C`, `M2C.4`, `M2C.5 Confirm and Remind`, `M2C.5 Post-Gate Router`, and `M2D` are existing runtime objects and safe to reference, not recreate.
- Message custom values under `SA360_MSG_M2`, `SA360_MSG_M2C_DAILY`, and event value custom values under `SA360_EVENT_VALUES` are existing reusable GHL copy/config values and safe to reference after copy review.

### Rename / Merge / Deprecate Candidates

- Rename or alias `sa360_subaccount_id` to the canonical payload name `subaccount_id_ghl` / display `GHL Subaccount ID` if GHL workflows can tolerate migration.
- Merge `Lead Status` and `sa360_lead_status` after deciding whether native field is raw/current CRM status and SA360 field is automation status.
- Merge or document `Lead Type`, `sa360_lead_type`, and `sa360_lead_type_normalized`.
- Merge `Queue State` into `sa360_routing_status` or future `ReviewItem` state if it is not actively used.
- Merge `Disposition Outcome` into `sa360_agent_disposition` or `sa360_voice_last_disposition` depending on owner.
- Deprecate one of the duplicate `sa360_ai_status` folder placements after confirming whether GHL duplicated the same field or only displays it in multiple folders.
- Deprecate versioned message values (`*_V2`) only after confirming which copies are referenced by published workflows.

### Workflows With Overlapping Responsibility

- GHL `M1A - New Lead Intake - Veteran` overlaps repo `M1A` lifecycle webhook intake. GHL should stamp/send payload; repo should own durable event ledger and Meta enqueue.
- GHL `M1B - Normalize and Lock Lead` overlaps repo validation/normalization/indexing concepts. GHL can own field normalization; repo owns schema validation and `InboundContactIndex`.
- GHL `M1C - Send Off` overlaps repo backend sync fields and lifecycle webhook dispatch. Confirm it is the only workflow sending lifecycle events.
- `M2C.4 - Appointment Booked`, `M2C.5 - Confirm and Remind`, `appointment_set`, and `appointment_status` overlap. Use event for history and field for current state.
- M3 voice workflows overlap repo Synthflow outbound context/result endpoints. GHL appears to initiate calls; repo logs context/results and should not also initiate calls without new design.

### Payload Fields Missing From GHL Screenshot

- `schema_version`
- `subaccount_id_ghl` exact-name field, though `sa360_subaccount_id` custom value exists.
- `contact_id_ghl` exact SA360 custom field, likely native GHL ID rather than custom field.
- `event_uuid`, `event_name_internal`, `event_name_meta`, `event_time_unix`, `send_to_meta`, and `currency` as GHL fields. This is acceptable if they are webhook payload-only or custom values.
- `phone` fallback raw payload field, though native phone is likely available.
- `city`, `country`, and `zip` exact payload names, though native fields likely exist.
- `niche_key` exact routing field, though `sa360_niche_label` and lead type fields exist.
- `updated_by` exact ownership field.

### GHL Fields Missing From Current Payload

- M2 cadence/control fields: `sa360_first_touch_completed`, `sa360_reply_detected`, `sa360_followup_day`, `sa360_next_contact_at`, `sa360_timing_gate_last_eval_at`, `sa360_no_reply_streak`.
- Channel orchestration fields: `sa360_channel_mode`, `sa360_channel_number`, `sa360_channel_locked`, `sa360_channel_selected_at`, `sa360_channel_switch_count`.
- Voice result/control fields: `sa360_voice_*`, `sa360_call_in_progress`, `sa360_pre_call_text_sent`, `sa360_post_call_text_sent`, `sa360_voice_provider_selected`.
- AI control fields: `sa360_ai_takeover_at`, `sa360_ai_last_status`, `sa360_ai_handoff_ready`, `sa360_ai_provider_selected`, `sa360_ai_mode`.
- Suppression/normalization fields: `sa360_spam_flag`, `sa360_dnc_flag`, `sa360_bad_number_flag`, `sa360_normalization_status`, `sa360_phone_status`, `sa360_email_status`, duplicate risk keys.
- Client/agent config fields: `sa360_client_*`, `sa360_agent_*`.
- Webform raw fields by niche. These should usually remain raw GHL/form data and not enter lifecycle payload unless needed.

### Beta MVP Build-Safe List

- Use existing GHL fields for payload stamping: `sa360_client_account_id`, `sa360_lead_uid`, `sa360_phone_e164`, `sa360_lifecycle_stage`, `sa360_appointment_status`, `sa360_policy_status`, `sa360_routing_status`, `sa360_source_platform`, `sa360_source_type`, `sa360_campaign_id`, `sa360_ad_id`, `sa360_fbclid`, and `sa360_utm_*`.
- Use existing published workflows for GHL-side routing: M1A/M1B/M1C and published M2A/M2B/M2C/M2D paths.
- Use existing custom values for calendars, pipelines/stages, message copy, event values, and webhook URL references, but do not duplicate them.
- Treat M3 voice as build-safe only for field/reference mapping; the workflows are draft and need payload/API reconciliation before production reliance.

### Human Decisions Needed

- Which object owns Meta sync: GHL field/custom value, repo env, or `ClientConfig`?
- Should GHL custom values containing secrets remain in GHL, or migrate to env/secret manager/DB?
- Is `sa360_subaccount_id` the accepted GHL alias for payload `subaccount_id_ghl`?
- Should `policy_issued` be a new repo event or just `policy_status=issued`?
- Which lead type/status/source fields are raw native fields vs normalized SA360 fields?
- Are M2E, M2C-GREEN, and M3V workflows required for beta despite draft status?
- Is M3V-D a real workflow missing from screenshot inventory or only a diagram branch?

## Likely Beta Launch Blockers

- Live GHL screenshot inventory has been reconciled for custom fields, custom values, and workflows, but exact GHL IDs/options, tags, forms, full webhook payload bodies, pipelines/stages exports, and workflow action details are still missing.
- Controlled vocabularies are not documented for `lifecycle_stage`, `appointment_status`, `policy_status`, `routing_status`, `lead_status`, and `agent_disposition`.
- Review Queue and Event Timeline are UI concepts without backend models/APIs.
- Feature flag model is not defined for BLUE/GREEN/CLOSEBOT/client-level voice controls.
- `policy_issued` is not in shared event types.
- GHL calendar IDs/links are env-configured but not reconciled with live calendar inventory.

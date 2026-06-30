# SA360 Do Not Create List

Do not create these items in GHL, Prisma, API schemas, admin C.O.C., or Figma handoff until the registry and live GHL inventory are reviewed.

## Deprecated / Do Not Build (new roadmap direction)

Do not create new roadmap initiatives around:

- Blue/green channel selection expansion.
- SendBlue fallback optimization as a core initiative.
- New Synthflow feature work.
- New CloseBot feature work.
- New voice AI routing/orchestration feature work.
- Orion-style front-end AI/CRM competition.
- Advanced channel selection as core product differentiator.

These pathways may remain for existing clients under legacy/retainer support, but they are out of scope for new product roadmap investment.

## Do Not Create As GHL Custom Fields

- `lead_created`, `first_response`, `appointment_set`, `appointment_showed`, `sale_logged`, `policy_issued`
  - These are historical events or candidate events. Use `LifecycleEvent` or approved event schema.
- `known_caller`, `unknown_caller`, `lookup_error`
  - These are per-request Synthflow/log signals. Use `SynthflowRequestLog`.
- `webhook_validation_failed`, `meta_dispatch_sent`, `meta_dispatch_skipped`, `meta_dispatch_failed`
  - These are processing outcomes. Use request logs, dispatch attempts, failed dispatches, or review records.
- `booking_allowed`, `reschedule_allowed`, `has_active_appointment`, `do_not_book_reason`, `script_goal`
  - These are derived outbound context values. Do not make them independent contact truth.
- `event_uuid`, `event_name_internal`, `event_name_meta`, `event_time_unix`
  - These belong to payload/event ledger rows, not mutable contact state.
- `meta_access_token`, `ADMIN_API_KEY`, `SA360_ADMIN_API_KEY`, `WEBHOOK_SECRET`
  - Secrets must remain in DB/env/secrets management.

## Do Not Create Duplicate Current-State Fields

- Duplicate lifecycle fields such as `lifecycle_stage_2`, `lead_stage`, or `stage`. GHL already has `sa360_lifecycle_stage`.
- Duplicate appointment fields such as `appointment_status_2`, `appt_status`, or status tags. GHL already has `sa360_appointment_status`.
- Duplicate routing fields such as `routing_status_2`, `route_status`, or route tags. GHL already has `sa360_routing_status`.
- Duplicate policy fields such as `policy_status_2`, `carrier_status`, `issued_tag`, or `sold_status`. GHL already has `sa360_policy_status`.
- Duplicate phone identifiers such as `phoneE164`, `phone_e164_alt`, or `caller_phone` as contact truth. `phone_e164`/native phone must be reconciled first.
- Duplicate tenant IDs such as `clientAccountId`, `client_account_id`, `ghlLocationId`, and `subaccount_id_ghl` without a single alias map.
- Duplicate AI status fields. GHL screenshot shows `sa360_ai_status` in both Lifecycle and AI Control folders; confirm whether this is one field displayed twice or a true duplicate before creating anything.
- Duplicate lead type/status/source fields. GHL already has native `Lead Type`, `Lead Status`, `Contact source`, plus SA360 variants.

## Do Not Create These Tags As Truth

- `SA360::M1::LEAD_CREATED`
- `SA360::M1::ATTRIBUTION_UPSERTED`
- `SA360::M1::CONTACT_INDEXED`
- `SA360::M2::APPOINTMENT_SET`
- `SA360::M2::SALE_LOGGED`
- `SA360::SYSTEM::KNOWN_CALLER`
- `SA360::SYSTEM::UNKNOWN_CALLER`
- `SA360::ERROR::LOOKUP_ERROR`
- `SA360::ERROR::INVALID_TOKEN`
- `SA360::ERROR::DOWNSTREAM_TIMEOUT`
- `SA360::LAUNCH::BLUE_ENABLED`
- `SA360::LAUNCH::GREEN_ENABLED`
- `SA360::VOICE::VOICE_ENABLED`
- `SA360::VOICE::CLOSEBOT_ENABLED`

Tags may be approved later only when they are minimal workflow triggers and not the source of current state.

## Do Not Create Duplicate Custom Values

- `SA360_CFG_META_ACCESS_TOKEN`
- `SA360_CFG_ADMIN_API_KEY`
- `SA360_CFG_OUTBOUND_CALENDAR_MAP`
- `SA360_CFG_META_DATASET_ID`
- Any `SA360_MSG_*` value that only repeats API response text such as `invalid_payload`, `internal_error`, `feature_disabled`, or `lookup_error`.
- Any message custom value duplicating an existing GHL template until GHL custom values/templates are exported.
- Any calendar custom value duplicating existing `SA360_CAL_*` or `SA360_CAL_LINK_*`.
- Any pipeline/stage custom value duplicating existing `SA360_PIPELINE_*` or `SA360_STAGE_*`.
- Any Meta dataset custom value duplicating existing `SA360_DATASET_*`.
- Any message value duplicating existing `SA360_MSG_M2*` values, including versioned `*_V2` values, until workflow references are audited.
- Any webhook/secret custom value duplicating existing `SA360_WEBHOOK_SECRET`, `SA360_SYNTHFLOW_API_KEY`, or `SA360_TOKEN_*`.

## Do Not Create Runtime Objects From Figma Alone

- Review Queue data model or tags from Figma `reviewItems`.
- Event Timeline event types from Figma `timeline` without mapping to DB models.
- Client flags `voice`, `blue`, `green`, `closeBot`, `ghlAi`, `metaSync` without a FeatureFlag/ClientConfig decision. GHL fields now exist (`sa360_client_*_enabled`), but repo runtime ownership is still undecided.
- Dashboard widgets or C.O.C. cards as GHL fields.
- M2FT-BLUE or M2FT-GREEN workflows. GHL already has `M2A.FT-BLUE - First Touch Send` and `M2A.FT-GREEN - First Touch Send`.

## Do Not Recreate Existing GHL Workflows

- `M1A - New Lead Intake - Veteran`
- `M1B - Normalize and Lock Lead`
- `M1C - Send Off`
- `M2A - First Contact Orchestrator`
- `M2A.5 - Immediate First Touch Watcher`
- `M2A.FT-BLUE - First Touch Send`
- `M2A.FT-GREEN - First Touch Send`
- `M2B - Timing Gate`
- `M2C - Response + Daily Cadence`
- `M2C-BLUE - Follow-Up Send`
- `M2C-GREEN - Follow-Up Send`
- `M2C-GUARD_TEMPLATE`
- `M2C.4 - Appointment Booked`
- `M2C.5 - Confirm and Remind`
- `M2C.5 - Post-Gate Router`
- `M2D - AI Handoff`
- `M2E - Fallback / No Reply`
- `M3V-A - Call New Lead`
- `M3V-B - Post Call Processing`
- `M3V-C - Voice Re-Engage`

## Do Not Create Tag Equivalents For Existing GHL State Fields

- Lifecycle: `sa360_lifecycle_stage`, `sa360_lead_status`, `sa360_outbound_stage`
- Appointment: `sa360_appointment_status`, `sa360_confirmation_status`, `sa360_booking_detected`
- Routing/channel: `sa360_routing_status`, `sa360_channel_mode`, `sa360_channel_locked`
- AI/voice: `sa360_ai_status`, `sa360_ai_last_status`, `sa360_call_in_progress`, `sa360_voice_last_status`, `sa360_voice_last_disposition`
- Suppression: `sa360_dnc_flag`, `sa360_bad_number_flag`, `sa360_spam_flag`

## Do Not Create Prisma/API Objects Yet

- `ReviewItem` model until queue ownership, inputs, and actions are defined.
- `SubaccountLink` model until GHL location/subaccount inventory is available.
- `FeatureFlag` model until env vs DB flag strategy is reviewed.
- `policy_issued` internal event until product decides whether it is a new event or a `policy_status` value.
- Replay endpoints until security, idempotency, and operator permissions are designed.

## Review Rule

If creating the item would make two systems able to disagree about the same fact, do not create it.

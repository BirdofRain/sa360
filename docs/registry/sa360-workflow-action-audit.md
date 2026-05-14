# SA360 Workflow Action Audit

Status: read-only audit from reconciled GHL screenshot/export inventory.

This document records what is currently known about GHL workflow actions and what still requires exact GHL action export data. It does not authorize creating, deleting, renaming, publishing, or modifying GHL fields, tags, custom values, workflows, Prisma models, or API routes.

## Audit Sources

- `docs/registry/sa360-workflows.csv`
- `docs/registry/sa360-workflow-action-audit-needed.md`
- `docs/registry/sa360-decision-matrix.md`
- `docs/registry/sa360-conflicts.md`
- GHL screenshot inventory source marker: `ghl_screenshot_inventory_2026_05_08`

## Audit Confidence

- Confirmed: workflow name, module/folder, published/draft/missing status, and high-level diagram logic were present in the reconciled screenshot inventory.
- Partial: trigger details, branch conditions, field reads/writes, custom value references, and webhook actions are inferred from screenshot notes and registry reconciliation.
- Missing: exact GHL action IDs, field IDs, dropdown option values, message bodies, webhook headers, redacted webhook payload bodies, enrollment settings, wait steps, and tag actions.

## Workflow Action Matrix

| Workflow | Current status | Known trigger / entry | Known action path | Known fields read | Known fields written | Custom values referenced | Webhook / API action | Audit decision | Human decision needed |
|---|---|---|---|---|---|---|---|---|---|
| `M1A - New Lead Intake - Veteran` | Published | New lead/contact/form trigger likely; exact trigger missing | Starts veteran lead intake and likely prepares lifecycle payload | `lead_uid`, `client_account_id`, `lead_type`, source fields | `sa360_lifecycle_stage`, `sa360_routing_status`, backend sync fields likely | Unknown | Likely `POST /webhooks/ghl/lifecycle-event`, exact action missing | Keep read-only; export exact trigger and webhook body | no |
| `M1B - Normalize and Lock Lead` | Published | Enrollment from M1A/intake; exact trigger missing | Normalizes raw lead/contact/form data and locks routing prep | Native phone/email/source, `Lead Type`, `Contact source`, webform fields | `sa360_normalization_status`, `sa360_phone_e164`, `sa360_phone_status`, `sa360_lead_type_normalized`, duplicate keys | Unknown | Possibly emits `lead_normalized` later; exact webhook action unknown | Keep; audit all raw-to-normalized writes | no |
| `M1C - Send Off` | Published | Handoff after normalization; exact trigger missing | Sends normalized lead into M2/backend sync path | `sa360_lifecycle_stage`, `sa360_routing_status`, `sa360_backend_sync_status` | `sa360_event_last_webhook_sent`, `sa360_event_last_webhook_sent_at`, `sa360_next_event_name` | `SA360_WEBHOOK_URL`, `SA360_WEBHOOK_SECRET` likely if webhook action exists | Likely lifecycle webhook send; exact body missing | Keep but confirm it is the only send-off webhook path | yes |
| `M2A - First Contact Orchestrator` | Published | Lead normalized/assigned with attempting-contact state | Routes first-contact path to first-touch watcher or timing gate | `sa360_first_touch_completed`, `sa360_channel_mode`, client/agent config fields | `sa360_outbound_stage`, `sa360_routing_status` likely | Unknown | No repo API action known | Keep; audit branch conditions | no |
| `M2A.5 - Immediate First Touch Watcher` | Published | First touch needed / FT not complete | Routes by selected channel: BLUE, GREEN, or VOICE path | `sa360_channel_mode`, `sa360_first_touch_completed` | Workflow routing only likely | Unknown | No repo API action known | Keep; resolve missing `M2FT-VOICE` branch | yes |
| `M2A.FT-BLUE - First Touch Send` | Published | Channel = BLUE first touch | Sends Blue first-touch message and enters day-1 cadence | `sa360_channel_mode`, `sa360_channel_number`, message values | `sa360_first_touch_completed`, `sa360_first_touch_type`, `sa360_followup_day`, `sa360_blue_attempt_count` | `SA360_MSG_M2FT_BLUE_ATTEMPT`, `SA360_MSG_M2FT_BLUE_ATTEMPT_V2`, `SA360_MSG_M2FT_BLUE_CONFIRM`, `SA360_MSG_M2FT_BLUE_CONFIRM_V2` | No repo API action known | Keep; audit exact active message value versions | no |
| `M2A.FT-GREEN - First Touch Send` | Published | Channel = GREEN first touch | Sends Green first-touch message and enters day-1 cadence | `sa360_channel_mode`, `sa360_channel_number`, message values | `sa360_first_touch_completed`, `sa360_first_touch_type`, `sa360_followup_day`, `sa360_green_attempt_count` | `SA360_MSG_M2FT_GREEN_ATTEMPT`, `SA360_MSG_M2FT_GREEN_ATTEMPT_V2`, `SA360_MSG_M2FT_GREEN_CONFIRM`, `SA360_MSG_M2FT_GREEN_CONFIRM_V2` | No repo API action known | Keep if Green is beta; otherwise do not depend on it | yes |
| `M2B - Timing Gate` | Published | FT complete or outbound follow-up needed | Evaluates allowed send window and releases outbound action | `sa360_next_contact_at`, client text window fields, timezone fields | `sa360_timing_gate_last_eval_at`, `sa360_routing_status` likely | Unknown | No repo API action known | Keep; audit wait steps and window comparisons | no |
| `M2C - Response + Daily Cadence` | Published | First touch sent / follow-up returned to cadence | Central hub; reply routes to M2D, no-reply/day-limit routes to M2E | `sa360_reply_detected`, `sa360_followup_day`, `sa360_no_reply_streak` | `sa360_followup_day`, `sa360_next_contact_at`, `sa360_routing_status` likely | Daily Blue/Green message values indirectly | No repo API action known | Keep; audit reply detection and terminal paths | no |
| `M2C-BLUE - Follow-Up Send` | Published | Post-gate router channel = BLUE | Sends Blue follow-up and returns to M2C | `sa360_channel_mode`, `sa360_blue_attempt_count`, message values | `sa360_blue_attempt_count`, `sa360_contact_attempt_count`, `sa360_next_contact_at` | `SA360_MSG_M2C_BLUE_FOLLOWUP_1`, `SA360_MSG_M2C_BLUE_DAY_*` possibly | No repo API action known | Keep; audit message choice and counter increment | no |
| `M2C-GREEN - Follow-Up Send` | Draft | Post-gate router channel = GREEN | Sends Green follow-up and returns to M2C | `sa360_channel_mode`, `sa360_green_attempt_count`, message values | `sa360_green_attempt_count`, `sa360_contact_attempt_count`, `sa360_next_contact_at` | `SA360_MSG_M2C_GREEN_FOLLOWUP_1`, `SA360_MSG_M2C_GREEN_REENGAGE` possibly | No repo API action known | Review; draft should not be beta dependency unless Green is in scope | yes |
| `M2C-GUARD_TEMPLATE` | Draft/template | Template only; exact trigger unknown | Reusable guard conditions for cadence branches | Unknown | Unknown | Unknown | None known | Keep as non-runtime template; verify no production enrollment | no |
| `M2C.4 - Appointment Booked` | Published | Booking detected / appointment booked | Updates booked state and routes to confirm/remind | `sa360_booking_detected`, `sa360_appointment_status`, `sa360_appointment_booked_at` | `sa360_lifecycle_stage`, `sa360_appointment_status`, `sa360_booking_source`, `sa360_appointment_set_at` | Calendar/pipeline/stage values likely | Likely lifecycle webhook for `appointment_set`; exact body missing | Keep; audit appointment payload mapping | no |
| `M2C.5 - Confirm and Remind` | Published | Booked appointment / pre-booked path | Sends confirmation and reminder messages | `sa360_confirmation_status`, appointment date/time fields, calendar link | `sa360_confirmation_status`, post-call text state possibly | `SA360_MSG_APPT_CONFIRM_GENERAL`, `SA360_MSG_M2C5_BLUE_REMIND_15M`, `SA360_MSG_M2C5_BLUE_REMIND_24H`, `SA360_MSG_M2C5_GREEN_REMIND_15M`, `SA360_MSG_M2C5_GREEN_REMIND_24H` | No repo API action known | Keep; audit reminder timing and active message values | no |
| `M2C.5 - Post-Gate Router` | Published | Released from timing gate | Branches by booked/pre-booked/channel/voice/fallback | `sa360_channel_mode`, `sa360_booking_detected`, `sa360_appointment_status` | Workflow routing only likely | Unknown | No repo API action known | Keep; audit branch priority and missing voice path | no |
| `M2D - AI Handoff` | Published | Reply detected from M2C | Routes to AI conversation / CloseBot | `sa360_reply_detected`, `sa360_ai_handoff_ready`, `sa360_client_closebot_enabled`, `sa360_ai_provider_selected` | `sa360_ai_takeover_at`, `sa360_ai_status`, `sa360_ai_last_status` | AI/CloseBot custom values unknown | No repo API action known | Keep with AI field/source review | yes |
| `M2E - Fallback / No Reply` | Draft | No-reply/day limit reached | Terminal no-reply / review path | `sa360_no_reply_streak`, `sa360_followup_day`, `sa360_client_sendblue_max_no_reply_attempts` | `sa360_needs_review`, `sa360_routing_status` likely | Unknown | No repo API action known | Review; decide if beta requires publish or Review Queue route | yes |
| `M2FT-VOICE - Review` | Diagram-only / needs review | Channel = VOICE from first-touch watcher | Review/manual path or M3 voice route after 120 sec no booking | `sa360_channel_mode`, `sa360_booking_detected` | `sa360_needs_review` likely | Unknown | No repo API action known | Missing concrete workflow; do not create until verified | yes |
| `M3V-A - Call New Lead` | Draft | Voice call path for new lead | Sets pre-call state, guards eligibility, fires Synthflow call, increments contact attempts | `sa360_voice_enabled`, `sa360_voice_provider_selected`, `sa360_channel_mode`, `sa360_call_in_progress`, phone | `sa360_pre_call_text_sent`, `sa360_call_in_progress`, `sa360_last_call_attempt_at`, `sa360_routing_status=VOICE_CALL_STARTED`, `sa360_contact_attempt_count` | `SA360_SYNTHFLOW_OUTBOUND_CALL_URL`, `SA360_SYNTHFLOW_MODEL_ID_VET`, `SA360_SYNTHFLOW_AGENT_PHONE` | External Synthflow call; repo has context/result endpoints but not call-initiation endpoint | Draft; block production reliance until exact action export | yes |
| `M3V-B - Post Call Processing` | Draft | Inbound webhook / added to workflow | Clears call-in-progress, branches by result | Call result, booked/no-answer status, `sa360_call_in_progress` | `sa360_call_in_progress=false`, `sa360_post_call_text_sent`, `sa360_routing_status`, `sa360_lifecycle_stage`, `sa360_ai_last_status` | Unknown | Must map to `/voice/synthflow/outbound-result`; exact webhook body missing | Draft; audit payload before use | yes |
| `M3V-C - Voice Re-Engage` | Draft | NO ANSWER / not booked branch from M3V-B | Retry/re-engage path | `sa360_voice_last_disposition`, `sa360_routing_status`, retry fields | `sa360_routing_status=VOICE_NO_ANSWER`, `sa360_voice_next_retry_at` likely | Unknown | No repo API action known | Draft; audit retry loop limits | yes |
| `M3V-D - Voice Booked Branch` | Missing inventory | Answered and booked diagram branch | Sets responded/completed state | Booked result / voice disposition | `sa360_lifecycle_stage=RESPONDED`, `sa360_ai_last_status=RESPONDED`, `sa360_routing_status=VOICE_COMPLETED` | Unknown | Related to outbound result `booked=true`; exact workflow missing | Missing; verify before any build | yes |

## Known Webhook / API Touchpoints

| Touchpoint | Known workflow source | Current evidence | Expected repo mapping | Missing audit data | Decision |
|---|---|---|---|---|---|
| Lifecycle webhook intake | `M1A` and/or `M1C` | Workflows likely send normalized lifecycle payload | `POST /webhooks/ghl/lifecycle-event` | Exact workflow action, headers, redacted body, response handling | Audit before adding new GHL logic |
| Appointment booked lifecycle event | `M2C.4 - Appointment Booked` | Booked path writes appointment fields | `event_name_internal=appointment_set`; `LifecycleEvent`; `InboundContactIndex.appointmentStatus` | Exact body and field mapping | Audit before appointment changes |
| Sale/opportunity event | Not confirmed in workflow action export | Pipeline/stage custom values exist | `event_name_internal=sale_logged` if implemented | Trigger, body, status mapping | Missing export |
| Synthflow outbound call initiation | `M3V-A` | Diagram references external Synthflow call | No repo route for call initiation; repo supports outbound context/result | Exact URL, auth, body, custom values | Draft; block production reliance |
| Synthflow post-call result | `M3V-B` | Diagram references inbound webhook result branch | `POST /voice/synthflow/outbound-result` if body matches schema | Redacted webhook body and branch mapping | Draft; audit required |
| Meta dispatch | Backend worker, not GHL workflow action | GHL has Meta custom values/tokens and sync flags | `LifecycleEvent` -> BullMQ -> `MetaDispatchAttempt` | Whether GHL gates `send_to_meta` before webhook send | Keep backend as dispatch owner |

## Field Read / Write Findings

### High-Confidence Current-State Fields

These fields are safe to reference as existing current-state fields; do not create tag equivalents.

| Field | Read/write usage | Owner source of truth | Notes |
|---|---|---|---|
| `sa360_lifecycle_stage` | Written by lifecycle/appointment/voice branches | GHL | Current lifecycle state. Historical event stays in repo `LifecycleEvent`. |
| `sa360_appointment_status` | Read/written by appointment booked and reminder paths | GHL | Current appointment state. |
| `sa360_policy_status` | Likely written by sale/policy workflows, exact workflow missing | GHL | Current policy state. |
| `sa360_routing_status` | Written by routing, timing, M3 voice branches | GHL | Current routing state. |
| `sa360_ai_status` / `sa360_ai_last_status` | Written/read by AI handoff and M3 booked branch | GHL | Duplicate folder placement still needs review. |
| `sa360_channel_mode` | Read by M2A.5, M2C.5, M3V-A | GHL | Determines BLUE/GREEN/VOICE path. |
| `sa360_booking_detected` | Read by post-gate/booked branches | GHL | Derived booking signal; avoid treating as event history. |
| `sa360_call_in_progress` | Read/write by M3V-A/B | GHL | Required by M3 guard; field was diagram-derived. |

### Raw / Normalized Fields Needing Workflow Reference Audit

| Field group | Risk | Required audit |
|---|---|---|
| `Lead Status` / `sa360_lead_status` | Duplicate status truth | List every workflow read/write of both fields. |
| `Lead Type` / `sa360_lead_type` / `sa360_lead_type_normalized` | Raw-vs-normalized ambiguity | Identify raw source, normalized target, and routing field. |
| `Contact source` / `sa360_source_platform` / `sa360_source_type` / `sa360_first_touch_source` / `sa360_origin_channel` | Source attribution drift | Identify which fields enter lifecycle payload and which are display/raw. |
| Raw niche webform fields | Payload bloat and duplicate normalized fields | Keep raw unless a workflow explicitly maps them to normalized SA360 fields. |

## Custom Value Reference Findings

| Custom value group | Known use | Secret? | Safe to display? | Audit decision |
|---|---|---|---|---|
| `SA360_MSG_M2FT_BLUE_*` | M2A.FT-BLUE first touch | no | yes, after copy review | Audit which base vs `V2` values are active. |
| `SA360_MSG_M2FT_GREEN_*` | M2A.FT-GREEN first touch | no | yes, after copy review | Audit if Green is beta and which versions are active. |
| `SA360_MSG_M2C_BLUE_*` | Blue daily/follow-up cadence | no | yes, after copy review | Audit day-selection logic. |
| `SA360_MSG_M2C_GREEN_*` | Green follow-up/re-engage | no | yes, after copy review | Draft workflow means beta use is undecided. |
| `SA360_MSG_M2C5_*` | Appointment reminders | no | yes, after copy review | Audit reminder timing and channel mapping. |
| `SA360_CAL_*` / `SA360_CAL_LINK_*` | Calendar IDs/links by niche | no | yes | Map to live GHL calendar inventory. |
| `SA360_PIPELINE_*` / `SA360_STAGE_*` | Pipeline/stage IDs | no | yes | Map to pipeline/stage export and lifecycle event/status mapping. |
| `SA360_SYNTHFLOW_OUTBOUND_CALL_URL` | M3V-A outbound call action | maybe URL-sensitive | no if query params/secrets | Missing from custom value screenshot; export exact key/value redacted. |
| `SA360_SYNTHFLOW_MODEL_ID_VET` | M3V-A model config | maybe | maybe | Missing from custom value screenshot; confirm exact key. |
| `SA360_SYNTHFLOW_AGENT_PHONE` | M3V-A caller/agent phone | phone number | no | Missing from custom value screenshot; redact value. |
| `SA360_SYNTHFLOW_API_KEY` | Synthflow auth/config | yes | no | Keep redacted; migrate later. |
| `SA360_WEBHOOK_SECRET` | Backend webhook auth | yes | no | Keep redacted; do not expose. |
| `SA360_TOKEN_*` | Meta tokens by niche | yes | no | Keep redacted; migrate later. |

## Missing Exact Export Data

The following are still blockers for a complete action audit:

- Exact triggers for every workflow.
- Exact branch conditions and order.
- Exact wait/delay/timing gate durations.
- Exact field IDs and dropdown option values.
- Exact message actions and active custom values.
- Exact webhook action URLs, headers, and redacted bodies.
- Exact tag add/remove actions.
- Exact workflow enrollment actions.
- Exact draft workflow unpublished changes.
- Confirmation whether `M3V-D` exists.
- Confirmation whether `M2FT-VOICE` exists or is only a diagram path.

## Read-Only Recommendations

- Do not create or rename GHL fields during this audit.
- Do not publish draft workflows from this audit.
- Do not create tag equivalents for lifecycle, routing, channel, AI, appointment, or suppression fields.
- Do not add repo runtime logic based on M3 voice until `M3V-A/B/C` payloads and custom values are fully exported.
- Use this document to request exact GHL exports, then update the registry decision docs before implementation.

## Next Export Request

Ask GHL admin/exporter for these per workflow:

| Workflow | Export needed |
|---|---|
| Published M1/M2 workflows | Full action list, branch conditions, field reads/writes, webhook actions, message actions, custom values. |
| Draft M2/M3 workflows | Draft action list, unpublished changes, intended beta decision. |
| `M3V-D` | Confirmation whether it exists as workflow, branch, or only diagram note. |
| `M2FT-VOICE` | Confirmation whether it exists as workflow, branch, Review Queue path, or only diagram note. |
| Webhook actions | Redacted request headers and bodies, including lifecycle and Synthflow post-call payloads. |

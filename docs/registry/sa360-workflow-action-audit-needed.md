# SA360 Workflow Action Audit Needed

The screenshot inventory confirmed workflow names and rough diagram logic, but not exact triggers, branch conditions, field IDs, custom value references, webhook actions, or payload bodies. This audit is required before adding more GHL logic.

## Audit Method

For each workflow, export or copy:

- Trigger type and trigger filters.
- Enrollment/re-entry settings.
- Every if/else branch condition.
- Every field read.
- Every field write.
- Every tag add/remove.
- Every custom value reference.
- Every message action and template/custom value used.
- Every webhook URL, method, headers, and redacted body.
- Every wait/delay/timing gate.
- Every stop/enroll-in-workflow action.

## Workflow Audit Matrix

| Workflow | Current status | Beta MVP required | Risk if not ready | Recommended action | Owner source of truth | Human decision needed |
|---|---|---|---|---|---|---|
| `M1A - New Lead Intake - Veteran` | published | yes | New leads may not enter canonical lifecycle pipeline or may duplicate webhook sends. | Audit trigger, webhook payload, field writes, and backend sync action. | GHL + repo lifecycle ingest | no |
| `M1B - Normalize and Lock Lead` | published | yes | Raw/native fields may diverge from normalized SA360 fields and payload may stamp wrong values. | Audit raw field reads and normalized writes for lead type, source, phone, timezone, duplicate keys. | GHL | no |
| `M1C - Send Off` | published | yes | Backend lifecycle webhook could be missed or sent twice. | Audit send-off conditions, webhook action, and fields written to backend sync status. | GHL | yes |
| `M2A - First Contact Orchestrator` | published | yes | Leads may skip first touch or timing gate. | Audit branch rules and fields used for first-touch-needed vs timing gate. | GHL | no |
| `M2A.5 - Immediate First Touch Watcher` | published | yes | Voice branch may route to missing path; first-touch channel may be wrong. | Audit BLUE/GREEN/VOICE conditions and missing `M2FT-VOICE` path. | GHL | yes |
| `M2A.FT-BLUE - First Touch Send` | published | yes | First touch may use wrong copy/number or fail to set cadence state. | Audit message value references, number/channel fields, attempt increments, and `sa360_first_touch_completed`. | GHL | no |
| `M2A.FT-GREEN - First Touch Send` | published | maybe | If Green is beta, first touch may be incomplete. If not beta, low risk. | Decide if Green is in beta. Audit like Blue if yes. | GHL | yes |
| `M2B - Timing Gate` | published | yes | Sends may violate client contact window or stall. | Audit timezone source, start/end hour fields, allowed-window branch, and re-entry delays. | GHL | no |
| `M2C - Response + Daily Cadence` | published | yes | No-reply/reply states may not route correctly to AI, fallback, or follow-ups. | Audit reply detection, day counters, no-reply limits, and enrollment into M2D/M2E/follow-up workflows. | GHL | no |
| `M2C-BLUE - Follow-Up Send` | published | yes | Blue cadence may not increment attempts or schedule next contact. | Audit messages, counters, `sa360_next_contact_at`, and return-to-cadence action. | GHL | no |
| `M2C-GREEN - Follow-Up Send` | draft | maybe | Green follow-up path unavailable if Green is beta. | Decide beta requirement. If yes, audit and publish after testing. | GHL | yes |
| `M2C-GUARD_TEMPLATE` | draft/template | no | Production contacts could accidentally enter template if miswired. | Confirm no production enrollment and label as template-only. | GHL | no |
| `M2C.4 - Appointment Booked` | published | yes | Booked appointments may not update canonical status or backend event. | Audit `sa360_booking_detected`, `sa360_appointment_status`, `sa360_appointment_set_at`, calendar fields, and webhook payload. | GHL | no |
| `M2C.5 - Confirm and Remind` | published | yes | Reminders may fail or duplicate messages. | Audit reminder delays, `SA360_MSG_M2C5_*` references, and confirmation status writes. | GHL | no |
| `M2C.5 - Post-Gate Router` | published | yes | Leads may branch to wrong channel or miss booked path. | Audit branch priority: booked, pre-booked, GREEN, BLUE, VOICE, fallback. | GHL | no |
| `M2D - AI Handoff` | published | maybe | Reply may not hand off correctly to AI/CloseBot or may duplicate agent workflow. | Audit `sa360_ai_*` fields, CloseBot/GHL AI conditions, and handoff completion state. | GHL | yes |
| `M2E - Fallback / No Reply` | draft | maybe | No-reply leads may have no terminal/review path. | Decide if beta requires no-reply terminal handling. If yes, complete and publish or route to Review Queue. | GHL | yes |
| `M3V-A - Call New Lead` | draft | maybe | Voice calls may not initiate safely or may use wrong Synthflow config. | Audit guard conditions, `SA360_SYNTHFLOW_*` custom values, outbound call action, and attempt writes. | GHL | yes |
| `M3V-B - Post Call Processing` | draft | maybe | Call results may not map to repo `/voice/synthflow/outbound-result`. | Audit inbound webhook payload, result branches, and fields written. | GHL + repo voice route | yes |
| `M3V-C - Voice Re-Engage` | draft | maybe | Retry behavior may loop or conflict with M2 cadence. | Audit retry limits, delay logic, `sa360_voice_next_retry_at`, and no-answer outcomes. | GHL | yes |
| `M3V-D` | missing | maybe | Booked voice calls may have no confirmed branch if diagram is accurate. | Confirm if this is a real workflow, branch inside M3V-B, or only diagram shorthand. | unknown | yes |
| `M2FT-VOICE` | diagram_only | maybe | Voice first-touch path may route nowhere. | Decide whether this should be Review Queue, M3V-A enrollment, or a dedicated workflow. | GHL/manual plan | yes |

## Required Webhook Payload Audits

| Payload source | Current status | Beta MVP required | Risk if not ready | Recommended action | Owner source of truth | Human decision needed |
|---|---|---|---|---|---|---|
| M1 lifecycle webhook body | missing exact body | yes | Repo may receive missing/incorrect lifecycle fields. | Export redacted body for `POST /webhooks/ghl/lifecycle-event`. | GHL sends, repo validates | no |
| Appointment booked webhook body | missing exact body | yes | `appointment_set` may not map to status/calendar fields. | Export redacted booked payload and map to lifecycle schema. | GHL sends, repo validates | no |
| Sale/opportunity webhook body | missing exact body | maybe | `sale_logged` and `policy_status` may diverge. | Export redacted sale/opportunity payload before adding sale logic. | GHL sends, repo validates | yes |
| Synthflow post-call webhook body | missing exact body | maybe | M3V-B may not match repo outbound-result schema. | Export redacted inbound webhook body and compare to `call_outbound_result`. | GHL/Synthflow sends, repo validates | yes |
| Backend sync status writes | missing exact actions | yes | GHL may show sync success while backend rejected payload. | Audit all `sa360_backend_sync_*` writes and response handling. | GHL + repo logs | yes |

## Field Read/Write Audit Checklist

For every workflow, record:

| Workflow | Field read | Field written | Action type | Expected value vocabulary | Maps to payload? | Notes |
|---|---|---|---|---|---|---|
| | | | condition/write/webhook/message | | yes/no | |

## Custom Value Reference Audit Checklist

| Workflow | Custom value | Purpose | Secret? | Safe to display? | Duplicate risk | Notes |
|---|---|---|---|---|---|---|
| | | message/calendar/token/url/config | yes/no | yes/no | low/medium/high | |

## Completion Criteria

This audit is complete when:

- Every published workflow has documented triggers, branches, reads, writes, messages, and webhook actions.
- Every webhook body has a redacted sample mapped to repo schema.
- Every custom value used by a published workflow is listed.
- Draft workflows have a beta decision: publish, keep draft, route to Review Queue, or remove from beta path.
- No new GHL fields/tags/workflows are needed to explain the current beta flow.

# SA360 automation checkpoint events (GHL → lifecycle webhook)

This document defines which **GoHighLevel (GHL) workflow** actions should POST to SA360 so the **Automation Visibility** dashboard (`GET /admin/v1/automation-dashboard/*`) can track workflow progression, appointments, human handoff, and signal health.

**Webhook endpoint:** `POST https://<api-domain>/webhooks/ghl/lifecycle-event`  
**Auth header:** `x-sa360-secret: <WEBHOOK_SECRET>`  
**Body:** JSON matching `LifecycleWebhookPayload` (`packages/shared/src/types.ts`).

---

## How GHL events map to the dashboard

| Dashboard section | API route | What it needs from checkpoints |
|-------------------|-----------|--------------------------------|
| Summary KPIs | `/summary` | Lead volume, appointments, bot touch, human queue, webhook/Meta failures |
| Workflow progression | `/workflow-progression` | Ordered funnel counts per checkpoint |
| Appointments | `/appointments` | Booked / upcoming rows, bot vs human scheduling |
| Signal health | `/signal-health` | Webhook processing status + Meta dispatch outcomes |
| Accounts | `/accounts` | Per `client_account_id` + location rollup |

**Naming convention for GHL workflows:** `SA360 — lifecycle: <checkpoint>` (example: `SA360 — lifecycle: appointment_set`).

---

## Required fields (every lifecycle POST)

Send these on **every** checkpoint. Optional blocks add fidelity for routing, appointments, and agent ownership.

| Block | Field | Required | Notes |
|-------|--------|----------|--------|
| Root | `schema_version` | Yes | Use `"1.0"` |
| Root | `client_account_id` | Yes | SA360 tenant id (stable per client) |
| Root | `subaccount_id_ghl` | Recommended | GHL location id; powers `locationId` filters |
| `contact` | `lead_uid` | Yes | Stable dedupe key across events for one lead |
| `contact` | `contact_id_ghl` | Recommended | GHL contact id when known |
| `contact` | `phone_e164` (or `phone` / `phone_digits`) | Recommended | Upserts `InboundContactIndex` |
| `contact` | `first_name`, `last_name`, `email` | Recommended | Display in appointments / accounts |
| `event` | `event_uuid` | Yes | **Globally unique** per POST (UUID v4 or `evt_<location>_<contact>_<unix>`) |
| `event` | `event_name_internal` | Yes | Must match a row in the tables below |
| `event` | `event_name_meta` | Yes | Meta CAPI event name when `send_to_meta` may be true |
| `event` | `event_time_unix` | Yes | Unix seconds (GHL “now” at fire time) |
| `state` | `lifecycle_stage` | Recommended | Human-readable stage for index + human_activation |
| `state` | `appointment_status` | When appointment-related | e.g. `Scheduled`, `Confirmed`, `Showed`, `No Show` |
| `state` | `routing_status` | When routed | Powers **routed** checkpoint inference |
| `state` | `ai_status` | When AI/bot touched lead | e.g. `engaged`, `booked_by_bot` |
| `ownership` | `assigned_agent_id`, `assigned_agent_name` | Recommended | Agent assignment on index |

**TypeScript union today:** `InternalEventName` in `packages/shared/src/types.ts` includes  
`lead_created`, `lead_normalized`, `contact_updated`, `first_response`, `appointment_set`, `appointment_showed`, `sale_logged`.  
Checkpoints marked **“via `contact_updated`”** below should use `event_name_internal: "contact_updated"` plus the documented `state` / metadata until the union is extended.

---

## Core checkpoint events

### `lead_created`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | New lead or contact created (form, funnel, manual create, import) — first time SA360 should index the person. |
| **Required fields** | All [required fields](#required-fields-every-lifecycle-post); `contact.lead_uid`; attribution if from paid social. |
| **`event_name_internal`** | `lead_created` |
| **`event_name_meta`** | `Lead` |
| **`send_to_meta`** | `true` in production when attribution (`fbclid`, `campaign_id`, etc.) is present; **`false`** for smoke/test. |
| **`value_score`** | `10`–`25` (top-of-funnel) |
| **Dashboard** | Summary (**leads received**), Workflow progression (**lead_created**), Accounts (**leads today**) |

---

### `lead_normalized`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | After phone/email validation, duplicate merge, or SA360-ready normalization (custom fields populated, E.164 phone set). |
| **Required fields** | Required root/contact/event; `state.lead_type` (niche) when known. |
| **`event_name_internal`** | `lead_normalized` |
| **`event_name_meta`** | `Lead` |
| **`send_to_meta`** | Usually `false` (avoid duplicate Lead signals); `true` only if this is the **first** attributable Lead for that person. |
| **`value_score`** | `10`–`20` |
| **Dashboard** | Workflow progression (**normalized**) |

---

### `routed`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Lead assigned to agent, round-robin complete, pipeline stage = routed, or `routing_status` set in workflow. |
| **Required fields** | Required root/contact/event; **`state.routing_status`** (e.g. `assigned`, `round_robin_complete`); `ownership.*` when assigned. |
| **`event_name_internal`** | `contact_updated` (**checkpoint label:** routed) |
| **`event_name_meta`** | `Contact` |
| **`send_to_meta`** | `false` (routing is operational, not a primary ads conversion). |
| **`value_score`** | `0`–`5` |
| **Dashboard** | Workflow progression (**routed**) — counted when `contact_updated` payload includes `state.routing_status` |

---

### `first_touch_sent`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | First outbound SMS/email/call attempt, or first inbound reply logged — automation “touched” the lead. |
| **Required fields** | Required root/contact/event; optional `state.ai_status: "first_touch"`. |
| **`event_name_internal`** | `first_response` |
| **`event_name_meta`** | `Contact` |
| **`send_to_meta`** | `false` unless this is your defined “qualified contact” signal. |
| **`value_score`** | `5`–`15` |
| **Dashboard** | Workflow progression (**first_touch_sent**) |

---

### `ai_engaged`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Prefer **not from GHL** — SA360 records this from **Synthflow inbound lookup** (`SynthflowRequestLog`). Optional GHL mirror: workflow after “AI call completed” tag. |
| **Required fields** | If mirrored from GHL: `contact_updated` + `state.ai_status: "engaged"` (or tag sync into `state`). |
| **`event_name_internal`** | N/A from GHL (use Synthflow); optional mirror: `contact_updated` |
| **`event_name_meta`** | `Contact` if mirrored |
| **`send_to_meta`** | `false` |
| **`value_score`** | `0` |
| **Dashboard** | Summary (**bot engaged**), Workflow progression (**ai_engaged**) from Synthflow logs |

---

### `appointment_set`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Calendar appointment booked (human or bot), including AI/Synthflow booking workflows. |
| **Required fields** | Required root/contact/event; **`state.appointment_status`** (e.g. `Scheduled`, `Set`); `state.lifecycle_stage` e.g. `Appointment Set`; `routing.calendar_id` / `calendar_link` when available. |
| **`event_name_internal`** | `appointment_set` |
| **`event_name_meta`** | `Schedule` |
| **`send_to_meta`** | **`true` in production** when Meta Schedule optimization is desired; see [Production safety](#production-safety). **`false`** for smoke/test. |
| **`value_score`** | `40`–`60` |
| **Dashboard** | Summary (**appointments set**, **upcoming today**), Workflow progression (**appointment_set**), Appointments |

---

### `appointment_confirmed`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Contact confirmed attendance (SMS reply, workflow “confirmed”, or status → Confirmed). |
| **Required fields** | Required root/contact/event; `state.appointment_status: "Confirmed"` (or your canonical string). |
| **`event_name_internal`** | `contact_updated` (**checkpoint label:** appointment_confirmed) |
| **`event_name_meta`** | `Contact` |
| **`send_to_meta`** | `false` (unless you explicitly map confirmations to a Meta custom event). |
| **`value_score`** | `15`–`25` |
| **Dashboard** | Appointments (status), Workflow progression (future: extend funnel) |

---

### `appointment_reminder_sent`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Reminder SMS/email/voice fired X hours before appointment (after send action succeeds, or immediately before send if GHL cannot confirm delivery). |
| **Required fields** | Required root/contact/event; **`state.appointment_status: "REMINDER_SENT"`**; `state.lifecycle_stage` e.g. `APPOINTMENT_SET`; stable `contact.lead_uid`. |
| **`event_name_internal`** | **`appointment_reminder_sent`** (preferred). Legacy: `contact_updated` + `appointment_status` `Reminder Sent` / `REMINDER_SENT` still counts on dashboard. |
| **`event_name_meta`** | `Contact` (required string; not used for ads when `send_to_meta: false`) |
| **`send_to_meta`** | **`false`** — operational checkpoint only; do not train Meta Schedule/Purchase. |
| **`value_score`** | `5` (low operational weight; `0`–`5` acceptable) |
| **Dashboard** | Summary (**remindersSent**), Workflow progression (**Reminder Sent**), Signal health (lifecycle counts), Appointments board |

**Implementation guide:** `docs/ghl/workflows/appointment-reminder-sent-workflow.md`

---

### `human_activation_needed`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Bot escalates to human, max attempts reached, “request callback”, or lifecycle stage = Attempting Contact / Follow Up / Needs Agent. |
| **Required fields** | Required root/contact/event; **`state.lifecycle_stage`** one of: `ATTEMPTING_CONTACT`, `FOLLOW_UP`, `NEW` (or your agency equivalents); optional `state.ai_status: "handoff"`. |
| **`event_name_internal`** | `contact_updated` (**checkpoint label:** human_activation_needed) |
| **`event_name_meta`** | `Contact` |
| **`send_to_meta`** | `false` |
| **`value_score`** | `0` |
| **Dashboard** | Summary (**human activation needed**), Workflow progression (**human_activation_needed**), Appointments (**needing human activation**) |

---

### `appointment_showed`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Appointment marked attended / showed (calendar outcome, manual disposition, or post-appointment workflow). |
| **Required fields** | Required root/contact/event; `state.appointment_status: "Showed"`; `state.lifecycle_stage` updated. |
| **`event_name_internal`** | `appointment_showed` |
| **`event_name_meta`** | `QualifiedLead` |
| **`send_to_meta`** | `true` when this is a primary qualified-lead signal for ads; **`false`** for test. |
| **`value_score`** | `60`–`80` |
| **Dashboard** | Workflow progression (downstream funnel), Summary (conversion proxy) |

---

### `no_show`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Appointment marked no-show or missed. |
| **Required fields** | Required root/contact/event; `state.appointment_status: "No Show"`; optional `state.dead_lead_flag: false` (still recyclable). |
| **`event_name_internal`** | `contact_updated` (**checkpoint label:** no_show) |
| **`event_name_meta`** | `Contact` |
| **`send_to_meta`** | `false` |
| **`value_score`** | `0`–`10` |
| **Dashboard** | Appointments (status), operational reporting |

---

### `outcome_logged`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Agent logs call outcome in GHL (disposition, note, tag) **or** rely on **Agent Workspace → What Happened** (preferred for agents). |
| **Required fields** | GHL path: `contact_updated` + `state.agent_disposition`; Workspace path: API `POST /agent-workspace/v1/actions/what-happened` (no lifecycle required). |
| **`event_name_internal`** | `contact_updated` (GHL) / workspace action `what_happened` (SA360) |
| **`event_name_meta`** | `Contact` |
| **`send_to_meta`** | `false` unless disposition maps to a Meta custom conversion you own. |
| **`value_score`** | Depends on disposition (0–`50`) |
| **Dashboard** | Workflow progression (**outcome_logged** — includes `sale_logged` + workspace actions) |

---

### `sale_logged`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Policy sold, payment taken, or pipeline stage = Sale / Won. |
| **Required fields** | Required root/contact/event; `state.policy_status` when applicable; revenue fields in custom fields if you sync them later. |
| **`event_name_internal`** | `sale_logged` |
| **`event_name_meta`** | `Purchase` |
| **`send_to_meta`** | `true` for production purchase optimization when value is known; **`false`** for test. |
| **`value_score`** | `80`–`100` (or actual premium if wired) |
| **Dashboard** | Workflow progression (**outcome_logged** / sale), Summary |

---

### `policy_issued`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | Carrier policy number issued / underwriting complete (post-sale). |
| **Required fields** | Required root/contact/event; **`state.policy_status: "Issued"`** (or your canonical value). |
| **`event_name_internal`** | `contact_updated` (**checkpoint label:** policy_issued) |
| **`event_name_meta`** | `Purchase` (or `Contact` if not sending purchase twice) |
| **`send_to_meta`** | `false` if `sale_logged` already sent Purchase; `true` only if this is the **first** purchase signal. |
| **`value_score`** | `90`–`100` |
| **Dashboard** | Summary, Accounts (health context) |

---

### `signal_sent`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | **Do not fire from GHL.** SA360 worker records **`MetaDispatchAttempt`** with `success: true` after lifecycle ingest with `send_to_meta: true`. |
| **Required fields** | N/A (backend) |
| **`event_name_internal`** | N/A |
| **`event_name_meta`** | Mirrors queued lifecycle event |
| **`send_to_meta`** | N/A |
| **`value_score`** | N/A |
| **Dashboard** | Signal health (**metaDispatch.succeeded**), Workflow progression (**signal_sent**) |

---

### `signal_failed`

| Item | Guidance |
|------|----------|
| **When GHL should fire** | **Do not fire from GHL.** Backend: failed `MetaDispatchAttempt`, `FailedDispatch` row, or webhook `processingStatus: failed`. |
| **Required fields** | N/A (backend) |
| **`event_name_internal`** | N/A |
| **`event_name_meta`** | N/A |
| **`send_to_meta`** | N/A |
| **`value_score`** | N/A |
| **Dashboard** | Summary (**signal failures**), Signal health (**metaDispatch.failed**, **recentFailedLogs**) |

---

## Production safety

### Meta Schedule (`appointment_set`)

- In **production**, `appointment_set` with complete attribution may use **`send_to_meta: true`** and **`event_name_meta: "Schedule"`** so the worker enqueues Meta CAPI dispatch (`MetaDispatchAttempt`).
- Enable only when `meta_pixel_id` / dataset configuration for that `client_account_id` is correct.
- Use **`value_score`** consistently (e.g. `50`) so reporting is comparable week over week.

### Smoke and test events

- Any workflow used for **QA, staging, or debug** must set **`send_to_meta: false`**.
- Use dedicated test `client_account_id`, `lead_uid`, and `contact_id_ghl` prefixes (e.g. `LAL-DEBUG-*`).
- See `docs/deploy/agent-workspace-smoke-tests.md` — mutating smoke scripts **always** force `send_to_meta: false`.

### Signals (`signal_sent` / `signal_failed`)

- **Prefer backend/worker** as the source of truth (actual HTTP result to Meta), not GHL webhooks.
- GHL should only send **intent** (`send_to_meta: true` on `lead_created`, `appointment_set`, `appointment_showed`, `sale_logged`); SA360 records success/failure.
- Do not create GHL workflows named “signal_sent” that POST to SA360 — it duplicates and can disagree with `MetaDispatchAttempt`.

### Idempotency

- Re-firing the same checkpoint with a **new** `event_uuid` creates a new `LifecycleEvent` row (expected for reminders and status updates).
- Re-using the same `event_uuid` is deduped at ingest — always generate a fresh UUID per workflow execution.

---

## Minimal v1 GHL workflow additions

Ship these five workflows first; they cover the largest gaps in Automation Visibility without waiting for schema changes.

| Priority | GHL workflow (suggested name) | Checkpoint | `event_name_internal` |
|----------|------------------------------|------------|------------------------|
| 1 | `SA360 — lifecycle: appointment_set (bot)` | Appointment booked by bot/AI | `appointment_set` |
| 2 | `SA360 — lifecycle: appointment_reminder_sent` | Reminder sent | `appointment_reminder_sent` (+ `state.appointment_status: REMINDER_SENT`) |
| 3 | `SA360 — lifecycle: human_activation_needed` | Human activation needed | `contact_updated` + `lifecycle_stage` |
| 4 | `SA360 — lifecycle: appointment_showed` / `no_show` | Showed or no-show | `appointment_showed` or `contact_updated` + `appointment_status` |
| 5 | `SA360 — lifecycle: outcome_logged` | Outcome / disposition logged | `contact_updated` + `agent_disposition` (or Agent Workspace What Happened) |

**Already expected in most stacks (verify they POST to SA360):** `lead_created`, `first_response` (first touch), `appointment_set` (human calendar). Add **`subaccount_id_ghl`** and **`contact.contact_id_ghl`** if missing.

---

## Reference: internal → Meta map (code)

From `packages/shared/src/event-map.ts`:

| `event_name_internal` | Default `event_name_meta` |
|-------------------------|---------------------------|
| `lead_created` | `Lead` |
| `lead_normalized` | `Lead` |
| `contact_updated` | `Contact` |
| `first_response` | `Contact` |
| `appointment_set` | `Schedule` |
| `appointment_showed` | `QualifiedLead` |
| `sale_logged` | `Purchase` |

---

## Example payload snippet (`appointment_set`, production)

```json
{
  "schema_version": "1.0",
  "client_account_id": "lal_client_0142",
  "subaccount_id_ghl": "loc_abc123",
  "contact": {
    "lead_uid": "LAL-2026-00042",
    "contact_id_ghl": "contact_xyz",
    "phone_e164": "+15551234567",
    "first_name": "Jane",
    "last_name": "Doe"
  },
  "attribution": {
    "source_platform": "facebook",
    "campaign_id": "120234567890",
    "fbclid": "IwAR..."
  },
  "state": {
    "lead_type": "Final Expense",
    "lifecycle_stage": "Appointment Set",
    "appointment_status": "Scheduled",
    "ai_status": "booked_by_bot"
  },
  "event": {
    "event_uuid": "evt_loc_abc_contact_xyz_1715789400",
    "event_name_internal": "appointment_set",
    "event_name_meta": "Schedule",
    "event_time_unix": 1715789400,
    "value_score": 50,
    "currency": "USD",
    "send_to_meta": true
  },
  "ownership": {
    "assigned_agent_id": "agent_12",
    "assigned_agent_name": "Alex Agent",
    "updated_by": "ghl_workflow_bot_booking"
  },
  "routing": {
    "calendar_id": "cal_123",
    "calendar_link": "https://..."
  }
}
```

**Staging / smoke:** same shape with `send_to_meta: false` and test ids.

---

## Example payload (`appointment_reminder_sent`, GHL copy-paste)

Use in workflow **SA360 — lifecycle: appointment_reminder_sent**. See full merge-field guide in `docs/ghl/workflows/appointment-reminder-sent-workflow.md`.

```json
{
  "schema_version": "1.0",
  "client_account_id": "{{custom_values.sa360_client_account_id}}",
  "subaccount_id_ghl": "{{location.id}}",
  "contact": {
    "lead_uid": "{{contact.custom_field.sa360_lead_uid}}",
    "contact_id_ghl": "{{contact.id}}",
    "first_name": "{{contact.first_name}}",
    "last_name": "{{contact.last_name}}",
    "email": "{{contact.email}}",
    "phone_e164": "{{contact.phone}}",
    "state": "{{contact.state}}"
  },
  "attribution": {
    "source_platform": "{{contact.source}}",
    "source_type": "",
    "campaign_id": "",
    "campaign_name": "",
    "adset_id": "",
    "adset_name": "",
    "ad_id": "",
    "ad_name": "",
    "fbclid": "",
    "utm_source": "",
    "utm_medium": "",
    "utm_campaign": "",
    "utm_content": "",
    "utm_term": ""
  },
  "state": {
    "lead_type": "{{contact.custom_field.sa360_niche_key}}",
    "lifecycle_stage": "{{contact.custom_field.sa360_lifecycle_stage}}",
    "appointment_status": "REMINDER_SENT",
    "ai_status": "{{contact.custom_field.sa360_ai_status}}",
    "routing_status": "{{contact.custom_field.sa360_routing_status}}",
    "policy_status": "{{contact.custom_field.sa360_policy_status}}"
  },
  "event": {
    "event_uuid": "{{contact.id}}-appointment_reminder_sent-{{appointment.id}}-{{right_now}}",
    "event_name_internal": "appointment_reminder_sent",
    "event_name_meta": "Contact",
    "event_time_unix": {{right_now}},
    "value_score": 5,
    "currency": "USD",
    "send_to_meta": false
  },
  "ownership": {
    "assigned_agent_id": "{{user.id}}",
    "assigned_agent_name": "{{user.name}}",
    "updated_by": "ghl_workflow"
  }
}
```

**`event_uuid` fallbacks:** `{{contact.id}}-appointment_reminder_sent-{{appointment.id}}-{{workflow.id}}` or `...-{{right_now}}` if appointment id unavailable. Must be unique per reminder execution.

**Webhook:** `POST {{custom_values.sa360_webhook_url}}` · Header `x-sa360-secret: {{custom_values.sa360_webhook_secret}}`

---

## Related docs

- Embed and webhook basics: `docs/ghl/agent-workspace-gohighlevel-embed.md` §8  
- Smoke safety: `docs/deploy/agent-workspace-smoke-tests.md`  
- Automation dashboard API: `apps/api/src/routes/automation-dashboard.ts`
- Reminder workflow (step-by-step): `docs/ghl/workflows/appointment-reminder-sent-workflow.md`

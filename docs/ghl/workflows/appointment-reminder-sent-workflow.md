# GHL workflow: SA360 — lifecycle: appointment_reminder_sent

Operational checkpoint for the **Automation Visibility** dashboard (`/automation-dashboard`). Fires when an appointment reminder SMS/email (or voice) step runs so SA360 can increment **Reminders sent** and the **Reminder Sent** funnel step.

**Do not send to Meta** for this event (`send_to_meta: false`).

---

## Prerequisites

### Location / agency custom values

Create these in GHL (location or company scope — same pattern as Agent Workspace embed):

| Custom value key | Example | Purpose |
|------------------|---------|---------|
| `sa360_webhook_url` | `https://sa360-sw6oq.ondigitalocean.app/webhooks/ghl/lifecycle-event` | Outbound webhook URL |
| `sa360_webhook_secret` | (long random string) | Must match API env `WEBHOOK_SECRET` |
| `sa360_client_account_id` | `lal_client_0142` | SA360 tenant id on every payload |

Optional contact custom fields (map into payload if you maintain them):

| GHL field | Payload path |
|-----------|----------------|
| `contact.custom_field.sa360_lead_uid` or your lead UID field | `contact.lead_uid` |
| `contact.custom_field.sa360_niche_key` | `state.lead_type` |
| `contact.custom_field.sa360_lifecycle_stage` | `state.lifecycle_stage` |
| `contact.custom_field.sa360_appointment_status` | `state.appointment_status` |

### API ingest (no schema change required)

- Route: `POST /webhooks/ghl/lifecycle-event`
- Header: `x-sa360-secret: <WEBHOOK_SECRET>`
- Zod (`apps/api/src/schemas/lifecycle-event.schema.ts`) accepts **any string** for `event.event_name_internal` and `event.event_name_meta`.
- Dashboard counts `event_name_internal: "appointment_reminder_sent"` (and legacy `contact_updated` + `REMINDER_SENT`).

---

## Workflow definition

| Item | Value |
|------|--------|
| **Name** | `SA360 — lifecycle: appointment_reminder_sent` |
| **Folder** | SA360 Lifecycle (recommended) |
| **Purpose** | Record that automation sent (or attempted) an appointment reminder |

### Recommended trigger

Use **one** of these patterns (pick what your subaccount already has):

1. **Best:** Existing **Appointment Reminder** workflow → add a final action **after** “Send SMS” / “Send Email” succeeds (or immediately after the send action if GHL cannot branch on delivery).
2. **Alternative:** Calendar workflow → **Appointment starts in X hours** → reminder branch → after send action.
3. **Acceptable fallback:** Immediately **before** send if your team cannot confirm delivery in GHL (document as “attempted reminder” in internal runbooks).

**Do not** attach this webhook to every contact update — only the dedicated reminder branch.

### Workflow steps (outline)

1. **Trigger** — Appointment reminder path (see above).
2. **Optional** — Update contact custom field `sa360_appointment_status` → `REMINDER_SENT` (helps legacy dashboards and agents in GHL).
3. **Send reminder** — SMS / Email / Voice (your existing template).
4. **Outbound Webhook** — POST JSON below (custom values + merge fields).
5. **Optional** — Internal note: “SA360 reminder checkpoint sent.”

---

## Outbound webhook configuration

| Setting | Value |
|---------|--------|
| **Method** | `POST` |
| **URL** | `{{custom_values.sa360_webhook_url}}` |
| **Headers** | `x-sa360-secret: {{custom_values.sa360_webhook_secret}}` |
| **Headers** | `Content-Type: application/json` |
| **Body** | Raw JSON (below) |

If GHL only supports a single “headers” text block:

```text
x-sa360-secret: {{custom_values.sa360_webhook_secret}}
Content-Type: application/json
```

---

## `event_uuid` (uniqueness)

SA360 dedupes on `event.event_uuid`. **Never** reuse the same UUID for two distinct reminder sends.

### Preferred (when merge fields exist)

```text
{{contact.id}}-appointment_reminder_sent-{{appointment.id}}-{{workflow.id}}
```

### Fallback A — contact + appointment + timestamp

```text
{{contact.id}}-appointment_reminder_sent-{{appointment.id}}-{{right_now}}
```

`{{right_now}}` must resolve to a unique value per execution (epoch seconds or ISO). Test in GHL that it changes on each run.

### Fallback B — contact + workflow + timestamp

```text
{{contact.id}}-appointment_reminder_sent-{{workflow.id}}-{{right_now}}
```

### Fallback C — contact only (not recommended)

If no appointment or workflow id is available:

```text
{{contact.id}}-appointment_reminder_sent-{{right_now}}
```

**QA rule:** Fire the workflow twice on the same contact; the second POST must use a **different** `event_uuid` or SA360 returns `duplicate: true` and will **not** create a second `LifecycleEvent` (index may still refresh).

---

## Full JSON body (copy-paste template)

Replace merge fields in GHL. Empty attribution strings are safe.

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
  },
  "routing": {
    "calendar_id": "{{appointment.calendar_id}}",
    "calendar_link": "{{appointment.calendar_link}}"
  }
}
```

### Field notes

| Field | Requirement | Notes |
|-------|-------------|--------|
| `schema_version` | Required | `"1.0"` |
| `client_account_id` | Required | From `sa360_client_account_id` custom value |
| `subaccount_id_ghl` | Strongly recommended | `{{location.id}}` for per-location dashboard filters |
| `contact.lead_uid` | Required | Stable SA360 lead key; must match other lifecycle events for same person |
| `contact.contact_id_ghl` | Recommended | `{{contact.id}}` |
| `contact.phone_e164` | Recommended | GHL `{{contact.phone}}` is normalized at ingest if E.164 |
| `state.appointment_status` | Required for legacy | Use `REMINDER_SENT` (also counted on legacy `contact_updated` path) |
| `state.lifecycle_stage` | Recommended | e.g. `APPOINTMENT_SET` or your GHL stage label |
| `event.event_name_internal` | Required | **`appointment_reminder_sent`** |
| `event.event_name_meta` | Required string | Use **`Contact`** (operational; not a conversion event) |
| `event.send_to_meta` | Required | **`false`** |
| `event.value_score` | Optional | `5` (low operational weight) |
| `ownership.updated_by` | Recommended | `ghl_workflow` |

If `lead_uid` custom field is empty, use your agency’s canonical UID merge field or a formula you already use for `lead_created` webhooks — **must be stable** for the contact.

---

## Meta guidance

| Setting | Value | Why |
|---------|--------|-----|
| `send_to_meta` | **`false`** | Reminder is operational telemetry, not Lead/Schedule/Purchase optimization |
| `event_name_meta` | `Contact` | Satisfies schema; ignored when `send_to_meta` is false |
| `value_score` | `0`–`5` | Low; do not use ad optimization scores |

**Do not** set `send_to_meta: true` on reminders. That would enqueue Meta CAPI jobs and can pollute ads learning with non-conversion signals.

---

## Dashboard validation checklist

After publishing the workflow:

1. **Trigger** a test appointment reminder on a **test contact** (dedicated `client_account_id` / `lead_uid` prefix).
2. **Webhook response** — HTTP **200**, body includes `"ok": true` (not `401` / `validation_failed`).
3. **WebhookRequestLog** — New row, `processingStatus` `stored` or `queued`, `eventNameInternal` = `appointment_reminder_sent`.
4. **LifecycleEvent** — Row with same `eventUuid`, `eventNameInternal` = `appointment_reminder_sent`.
5. **Automation Visibility** — Open `/automation-dashboard`, range **Today** or **7 Days**:
   - **Reminders sent** KPI increments.
   - **Workflow progression** → **Reminder Sent** count increments.
   - **Signal health** → lifecycle event list includes `appointment_reminder_sent`.
6. **Duplicate test** — Re-run with a **new** `event_uuid`; count should increment again. Re-run with the **same** `event_uuid`; should **not** double-count lifecycle (duplicate refresh only).

### PowerShell smoke (optional)

```powershell
$base = $env:NEXT_PUBLIC_SA360_API_BASE_URL
$secret = $env:SA360_WEBHOOK_SECRET
$body = @{
  schema_version = "1.0"
  client_account_id = "lal_client_TEST"
  subaccount_id_ghl = "loc_test"
  contact = @{
    lead_uid = "LAL-TEST-REMINDER-001"
    contact_id_ghl = "contact_test_001"
    first_name = "Test"
    last_name = "Reminder"
    phone_e164 = "+15555550199"
  }
  attribution = @{ source_platform = "test" }
  state = @{
    lifecycle_stage = "APPOINTMENT_SET"
    appointment_status = "REMINDER_SENT"
  }
  event = @{
    event_uuid = "contact_test_001-appointment_reminder_sent-$(Get-Date -UFormat %s)"
    event_name_internal = "appointment_reminder_sent"
    event_name_meta = "Contact"
    event_time_unix = [int][double]::Parse((Get-Date -UFormat %s))
    value_score = 5
    send_to_meta = $false
  }
  ownership = @{ updated_by = "ghl_workflow" }
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "$base/webhooks/ghl/lifecycle-event" `
  -Headers @{ "x-sa360-secret" = $secret; "Content-Type" = "application/json" } `
  -Body $body
```

---

## Troubleshooting

| Symptom | Likely cause |
|---------|----------------|
| `401 Unauthorized` | `sa360_webhook_secret` ≠ API `WEBHOOK_SECRET` |
| `validation_failed` | Missing `client_account_id`, `contact.lead_uid`, or `event.event_uuid` |
| `duplicate: true`, count unchanged | Reused `event_uuid` |
| Dashboard still 0 | Wrong date range, wrong `client_account_id` filter, or event older than range |
| `remindersSent` 0 but row exists | Confirm `event_name_internal` is exactly `appointment_reminder_sent` (or legacy `contact_updated` + `REMINDER_SENT`) |

---

## Related docs

- Checkpoint catalog: `docs/ghl/sa360-automation-checkpoint-events.md`
- Webhook basics: `docs/ghl/agent-workspace-gohighlevel-embed.md` §8
- Smoke safety: `docs/deploy/agent-workspace-smoke-tests.md`

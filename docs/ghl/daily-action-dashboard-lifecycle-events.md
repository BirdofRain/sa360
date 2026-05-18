# Daily Action Dashboard — GHL lifecycle event transmission

Operational events for the **Daily Action Center** (`GET /admin/v1/action-dashboard/today`) should POST to the existing lifecycle webhook.

**Endpoint:** `POST https://<api-domain>/webhooks/ghl/lifecycle-event`  
**Header:** `x-sa360-secret: <WEBHOOK_SECRET>`  
**Body:** JSON validated by `lifecycleEventSchema` (`apps/api/src/schemas/lifecycle-event.schema.ts`).

No Prisma migration is required — events are stored in `LifecycleEvent.payloadJson` and contact state is upserted to `InboundContactIndex`.

---

## Supported `event_name_internal` values

### Daily Action Dashboard (preferred explicit names)

- `appointment_set`, `appointment_confirmed`, `appointment_showed`, `appointment_no_show`, `appointment_cancelled`, `appointment_rescheduled`
- `contact_replied`, `ai_responded`, `ai_booked`, `ai_booking_failed`
- `call_attempt_logged`, `call_connected`, `call_no_answer`
- `disposition_logged`, `follow_up_needed`, `quote_given`, `sold`
- `bad_number`, `dnc`, `dead_lead`, `policy_issued`

### Legacy / automation checkpoints (still supported)

- `lead_created`, `lead_normalized`, `contact_updated`, `first_response`, `ai_engaged`
- `appointment_reminder_sent`, `human_activation_needed`, `no_show`, `sale_logged`, `outcome_logged`, `signal_sent`

---

## Normalized payload shape

| Block | Required | Notes |
|-------|----------|--------|
| `schema_version` | Yes | e.g. `"1.0"` |
| `client_account_id` | Yes | SA360 tenant id |
| `subaccount_id_ghl` | Recommended | GHL location id |
| `contact` | Yes | `lead_uid` required; `contact_id_ghl`, `phone_e164` recommended |
| `attribution` | No | Omit for operational-only events |
| `state` | Yes | Object (may be `{}`); enriched from event type + optional blocks |
| `event` | Yes | `event_uuid` (unique), `event_name_internal`, `event_name_meta` |
| `ownership` | No | Agent assignment |
| `routing` | No | Calendar / niche routing |
| `appointment` | No | `scheduled_at`, `status`, `source`, … |
| `call` | No | `direction`, `outcome`, `duration_seconds`, … |
| `policy` | No | `policy_status`, `premium_estimate`, … |
| `ai` | No | `booked`, `channel`, `failure_reason`, … |
| `disposition` | No | `code`, `notes`, `logged_by` |

SA360 merges optional blocks and event-type defaults into `state` before storing the event and upserting `InboundContactIndex` (`enrichLifecyclePayloadForIngest`).

**Deduplication:** duplicate `event_uuid` returns success without inserting a second `LifecycleEvent` row (index may still refresh).

**Meta:** set `send_to_meta: false` for operational smoke tests and most non-conversion checkpoints.

---

## GHL payload examples

### 1. `appointment_set`

```json
{
  "schema_version": "1.0",
  "client_account_id": "client_demo",
  "subaccount_id_ghl": "loc_demo_ghl_001",
  "contact": {
    "lead_uid": "lead_maria_001",
    "contact_id_ghl": "ghl_c_88421",
    "first_name": "Maria",
    "last_name": "Santos",
    "phone_e164": "+15551234001",
    "email": "maria@example.com"
  },
  "state": {
    "lifecycle_stage": "APPOINTMENT_SET",
    "appointment_status": "Scheduled"
  },
  "event": {
    "event_uuid": "evt_appt_set_maria_20260520",
    "event_name_internal": "appointment_set",
    "event_name_meta": "Schedule",
    "event_time_unix": 1716123600,
    "send_to_meta": false
  },
  "ownership": {
    "assigned_agent_id": "agent_001",
    "assigned_agent_name": "Jordan Rivera"
  },
  "appointment": {
    "appointment_id": "appt_ghl_99",
    "scheduled_at": "2026-05-21T15:30:00.000Z",
    "timezone": "America/Chicago",
    "status": "Scheduled",
    "calendar_id": "cal_main",
    "source": "ai"
  },
  "ai": {
    "channel": "voice",
    "booked": true,
    "provider": "synthflow"
  },
  "routing": {
    "calendar_link": "https://api.leadconnectorhq.com/widget/booking/example"
  }
}
```

### 2. `contact_replied`

```json
{
  "schema_version": "1.0",
  "client_account_id": "client_demo",
  "subaccount_id_ghl": "loc_demo_ghl_001",
  "contact": {
    "lead_uid": "lead_robert_002",
    "contact_id_ghl": "ghl_c_77102",
    "first_name": "Robert",
    "last_name": "Chen",
    "phone_e164": "+15559876543"
  },
  "state": {
    "lifecycle_stage": "AI_ENGAGED"
  },
  "event": {
    "event_uuid": "evt_reply_robert_20260520",
    "event_name_internal": "contact_replied",
    "event_name_meta": "Contact",
    "event_time_unix": 1716127200,
    "send_to_meta": false
  }
}
```

### 3. `call_attempt_logged`

```json
{
  "schema_version": "1.0",
  "client_account_id": "client_demo",
  "subaccount_id_ghl": "loc_demo_ghl_001",
  "contact": {
    "lead_uid": "lead_patricia_003",
    "contact_id_ghl": "ghl_c_55290",
    "first_name": "Patricia",
    "last_name": "Nguyen",
    "phone_e164": "+15557654321"
  },
  "state": {
    "lifecycle_stage": "ATTEMPTING_CONTACT"
  },
  "event": {
    "event_uuid": "evt_call_attempt_patricia_20260520",
    "event_name_internal": "call_attempt_logged",
    "event_name_meta": "Contact",
    "event_time_unix": 1716130800,
    "send_to_meta": false
  },
  "call": {
    "call_id": "call_ghl_441",
    "direction": "outbound",
    "outcome": "attempted",
    "duration_seconds": 0,
    "logged_at": "2026-05-20T14:00:00.000Z"
  },
  "ownership": {
    "assigned_agent_name": "Jordan Rivera"
  }
}
```

### 4. `disposition_logged`

```json
{
  "schema_version": "1.0",
  "client_account_id": "client_demo",
  "subaccount_id_ghl": "loc_demo_ghl_001",
  "contact": {
    "lead_uid": "lead_james_004",
    "contact_id_ghl": "ghl_c_44108",
    "first_name": "James",
    "last_name": "Okonkwo",
    "phone_e164": "+15553334444"
  },
  "state": {},
  "event": {
    "event_uuid": "evt_disp_james_20260520",
    "event_name_internal": "disposition_logged",
    "event_name_meta": "Contact",
    "event_time_unix": 1716134400,
    "send_to_meta": false
  },
  "disposition": {
    "code": "interested",
    "notes": "Ready for policy review call",
    "logged_by": "Jordan Rivera"
  }
}
```

### 5. `sold`

```json
{
  "schema_version": "1.0",
  "client_account_id": "client_demo",
  "subaccount_id_ghl": "loc_demo_ghl_001",
  "contact": {
    "lead_uid": "lead_james_004",
    "contact_id_ghl": "ghl_c_44108",
    "first_name": "James",
    "last_name": "Okonkwo",
    "phone_e164": "+15553334444"
  },
  "state": {},
  "event": {
    "event_uuid": "evt_sold_james_20260520",
    "event_name_internal": "sold",
    "event_name_meta": "Purchase",
    "event_time_unix": 1716141600,
    "value_score": 9500,
    "currency": "USD",
    "send_to_meta": false
  },
  "policy": {
    "policy_status": "Issued",
    "status": "issued",
    "premium_estimate": 9500,
    "carrier": "Demo Mutual",
    "policy_number": "POL-2026-001"
  }
}
```

---

## Local test commands

```bash
# Unit tests (schema + enrich)
cd apps/api && pnpm test

# Rebuild shared types if worker consumes them
pnpm --filter @sa360/shared build
```

## PowerShell smoke tests

```powershell
# From repo root — posts the five example event types (requires API + DB + secret)
.\scripts\test-lifecycle-dashboard-events.ps1 `
  -ApiBaseUrl "http://localhost:3000" `
  -WebhookSecret $env:SA360_WEBHOOK_SECRET `
  -ClientAccountId "client_demo" `
  -LocationId "loc_demo_ghl_001"
```

## Prisma Studio checks

1. **`LifecycleEvent`** — filter `clientAccountId`, sort `receivedAt` desc; confirm `eventNameInternal` and `payloadJson.state` after enrichment.
2. **`InboundContactIndex`** — same `clientAccountId` + `subaccountIdGhl`; verify `lifecycleStage`, `appointmentStatus`, `policyStatus`, `assignedAgentName`, `lastSeenAt`.
3. **`LeadAttribution`** — only changes when `attribution` block has non-empty fields (unchanged for examples 2–5 above).

Then reload Action Center:

`/action-center?clientAccountId=client_demo&locationId=loc_demo_ghl_001`

# Posts Daily Action Dashboard lifecycle examples to POST /webhooks/ghl/lifecycle-event
param(
  [string]$ApiBaseUrl = $env:SA360_API_BASE_URL,
  [string]$WebhookSecret = $env:SA360_WEBHOOK_SECRET,
  [string]$ClientAccountId = "client_demo",
  [string]$LocationId = "loc_demo_ghl_001"
)

if ([string]::IsNullOrWhiteSpace($ApiBaseUrl)) { $ApiBaseUrl = "http://localhost:3000" }
if ([string]::IsNullOrWhiteSpace($WebhookSecret)) {
  Write-Error "Set -WebhookSecret or SA360_WEBHOOK_SECRET"
  exit 1
}

$ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
$uid = [guid]::NewGuid().ToString("N").Substring(0, 8)

function Post-LifecycleEvent([string]$Name, [hashtable]$Body) {
  $json = $Body | ConvertTo-Json -Depth 12 -Compress
  try {
    $r = Invoke-WebRequest -Uri "$ApiBaseUrl/webhooks/ghl/lifecycle-event" -Method POST `
      -Headers @{ "x-sa360-secret" = $WebhookSecret; "Content-Type" = "application/json" } `
      -Body $json -UseBasicParsing -TimeoutSec 60
    Write-Host "PASS $Name HTTP $($r.StatusCode)"
    return $true
  }
  catch {
    Write-Host "FAIL $Name $($_.Exception.Message)"
    return $false
  }
}

$contact = @{
  lead_uid       = "lead_dash_smoke_$uid"
  contact_id_ghl = "ghl_dash_smoke_$uid"
  first_name     = "Dash"
  last_name      = "Smoke"
  phone_e164     = "+1555900$($uid.Substring(0, 4))"
}

$ok = $true
$ok = (Post-LifecycleEvent "appointment_set" @{
  schema_version    = "1.0"
  client_account_id = $ClientAccountId
  subaccount_id_ghl = $LocationId
  contact           = $contact
  state             = @{ lifecycle_stage = "APPOINTMENT_SET"; appointment_status = "Scheduled" }
  event             = @{
    event_uuid          = "evt_appt_set_$uid"
    event_name_internal = "appointment_set"
    event_name_meta     = "Schedule"
    event_time_unix     = $ts
    send_to_meta        = $false
  }
  appointment       = @{ scheduled_at = "2026-05-21T15:00:00.000Z"; status = "Scheduled"; source = "ai" }
  ai                = @{ booked = $true; channel = "voice" }
}) -and $ok

$ok = (Post-LifecycleEvent "contact_replied" @{
  schema_version    = "1.0"
  client_account_id = $ClientAccountId
  subaccount_id_ghl = $LocationId
  contact           = $contact
  state             = @{}
  event             = @{
    event_uuid          = "evt_reply_$uid"
    event_name_internal = "contact_replied"
    event_name_meta     = "Contact"
    event_time_unix     = $ts
    send_to_meta        = $false
  }
}) -and $ok

$ok = (Post-LifecycleEvent "call_attempt_logged" @{
  schema_version    = "1.0"
  client_account_id = $ClientAccountId
  subaccount_id_ghl = $LocationId
  contact           = $contact
  state             = @{}
  event             = @{
    event_uuid          = "evt_call_$uid"
    event_name_internal = "call_attempt_logged"
    event_name_meta     = "Contact"
    event_time_unix     = $ts
    send_to_meta        = $false
  }
  call              = @{ direction = "outbound"; outcome = "attempted"; duration_seconds = 0 }
}) -and $ok

$ok = (Post-LifecycleEvent "disposition_logged" @{
  schema_version    = "1.0"
  client_account_id = $ClientAccountId
  subaccount_id_ghl = $LocationId
  contact           = $contact
  state             = @{}
  event             = @{
    event_uuid          = "evt_disp_$uid"
    event_name_internal = "disposition_logged"
    event_name_meta     = "Contact"
    event_time_unix     = $ts
    send_to_meta        = $false
  }
  disposition       = @{ code = "interested"; notes = "smoke test" }
}) -and $ok

$ok = (Post-LifecycleEvent "sold" @{
  schema_version    = "1.0"
  client_account_id = $ClientAccountId
  subaccount_id_ghl = $LocationId
  contact           = $contact
  state             = @{}
  event             = @{
    event_uuid          = "evt_sold_$uid"
    event_name_internal = "sold"
    event_name_meta     = "Purchase"
    event_time_unix     = $ts
    send_to_meta        = $false
  }
  policy            = @{ policy_status = "Issued"; premium_estimate = 5000 }
}) -and $ok

if (-not $ok) { exit 1 }
Write-Host "Done. Check LifecycleEvent + InboundContactIndex for lead_uid=lead_dash_smoke_$uid"

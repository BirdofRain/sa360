# Smoke test: POST /admin/v1/action-dashboard/actions
param(
  [string]$BaseUrl = "http://localhost:3000",
  [string]$AdminKey = $env:SA360_ADMIN_KEY,
  [string]$ClientAccountId = "demo",
  [string]$LocationId = "loc_demo",
  [string]$ContactIdGhl = "ghl_demo_contact",
  [string]$PhoneE164 = "+15551234567"
)

if (-not $AdminKey) {
  $AdminKey = $env:ADMIN_API_KEY
}
if (-not $AdminKey) {
  Write-Error "Set SA360_ADMIN_KEY or ADMIN_API_KEY"
  exit 1
}

$headers = @{
  "x-sa360-admin-key" = $AdminKey
  "Content-Type"      = "application/json"
}

$body = @{
  clientAccountId = $ClientAccountId
  locationId      = $LocationId
  contactIdGhl    = $ContactIdGhl
  phoneE164       = $PhoneE164
  actionCode      = "CALL_ATTEMPT"
  actor           = @{ source = "action_center"; agentName = "Smoke Test" }
} | ConvertTo-Json -Depth 5

$url = "$BaseUrl/admin/v1/action-dashboard/actions"
Write-Host "POST $url"
$res = Invoke-RestMethod -Method POST -Uri $url -Headers $headers -Body $body
$res | ConvertTo-Json -Depth 6

if (-not $res.ok) { exit 1 }
Write-Host "actionId=$($res.actionId) events=$($res.eventsCreated.Count) ghl=$($res.ghlWriteback.status)"

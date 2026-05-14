#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only (default) smoke tests for SA360 Agent Workspace: API health, guidance, admin-coc page, CSP headers.

.DESCRIPTION
  Required env: SA360_API_BASE_URL, SA360_ADMIN_COC_BASE_URL, SA360_WORKSPACE_KEY, SA360_CLIENT_ACCOUNT_ID, SA360_GHL_LOCATION_ID
  Optional: SA360_GHL_CONTACT_ID, SA360_LEAD_UID, SA360_NICHE_KEY (default FEX), SA360_LIFECYCLE_STAGE (default ATTEMPTING_CONTACT),
            SA360_WEBHOOK_SECRET, ALLOW_MUTATING_SMOKE_TESTS (default false), EXPECTED_FRAME_ANCESTORS, SA360_PROTECTED_ROUTE (default /clients)

  Secrets are never printed. Exit code 1 if any required check fails.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$script:Failures = 0
$script:Skips = 0

function Write-Result {
  param(
    [ValidateSet("PASS", "FAIL", "SKIP", "WARN")]
    [string]$Status,
    [string]$CheckName,
    [string]$Detail = ""
  )
  $line = "[$Status] $CheckName"
  if ($Detail) { $line += " - $Detail" }
  switch ($Status) {
    "PASS" { Write-Host $line -ForegroundColor Green }
    "FAIL" { Write-Host $line -ForegroundColor Red; $script:Failures++ }
    "SKIP" { Write-Host $line -ForegroundColor Yellow; $script:Skips++ }
    "WARN" { Write-Host $line -ForegroundColor DarkYellow }
  }
}

function Get-RequiredEnv {
  param([Parameter(Mandatory)][string]$Name)
  $raw = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($raw)) {
    Write-Result "FAIL" "env:$Name" "required environment variable is missing"
    exit 1
  }
  return $raw.Trim()
}

function Get-OptionalEnv {
  param([string]$Name, [string]$Default = "")
  $raw = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($raw)) { return $Default }
  return $raw.Trim()
}

function Normalize-BaseUrl {
  param([string]$Url)
  $u = $Url.Trim().TrimEnd("/")
  if ($u -notmatch "^https?://") {
    throw "URL must start with http:// or https:// : $u"
  }
  return $u
}

# --- Required env ---
$apiBase = Normalize-BaseUrl (Get-RequiredEnv "SA360_API_BASE_URL")
$cocBase = Normalize-BaseUrl (Get-RequiredEnv "SA360_ADMIN_COC_BASE_URL")
$workspaceKey = Get-RequiredEnv "SA360_WORKSPACE_KEY"
$clientAccountId = Get-RequiredEnv "SA360_CLIENT_ACCOUNT_ID"
$locationId = Get-RequiredEnv "SA360_GHL_LOCATION_ID"

$nicheKey = Get-OptionalEnv "SA360_NICHE_KEY" "FEX"
$lifecycleStage = Get-OptionalEnv "SA360_LIFECYCLE_STAGE" "ATTEMPTING_CONTACT"
$contactId = Get-OptionalEnv "SA360_GHL_CONTACT_ID" ""
$leadUid = Get-OptionalEnv "SA360_LEAD_UID" ""
$webhookSecret = Get-OptionalEnv "SA360_WEBHOOK_SECRET" ""
$mutatingRaw = Get-OptionalEnv "ALLOW_MUTATING_SMOKE_TESTS" "false"
$mutating = @("1", "true", "yes", "on") -contains $mutatingRaw.ToLowerInvariant()
$expectedFrameAncestors = Get-OptionalEnv "EXPECTED_FRAME_ANCESTORS" ""
$protectedRoute = Get-OptionalEnv "SA360_PROTECTED_ROUTE" "/clients"
if (-not $protectedRoute.StartsWith("/")) { $protectedRoute = "/$protectedRoute" }

Write-Host ""
Write-Host "SA360 Agent Workspace smoke (secrets redacted)"
Write-Host "  API base:    $apiBase"
Write-Host "  admin-coc:   $cocBase"
Write-Host "  client:      $clientAccountId"
Write-Host "  location:    $locationId"
Write-Host "  niche/stage: $nicheKey / $lifecycleStage"
Write-Host "  mutating:    $mutating"
Write-Host ""

$wsHeaders = @{ "x-sa360-workspace-key" = $workspaceKey }

# --- A) API health ---
foreach ($path in @("/health", "/health/db", "/health/queue")) {
  $name = "api:$path"
  try {
    $r = Invoke-WebRequest -Uri "$apiBase$path" -Method GET -UseBasicParsing -TimeoutSec 60
    if ($r.StatusCode -ne 200) {
      Write-Result "FAIL" $name "HTTP $($r.StatusCode)"
      continue
    }
    $j = $r.Content | ConvertFrom-Json
    if (-not $j.ok) {
      Write-Result "FAIL" $name "JSON ok is not true"
      continue
    }
    if ($path -eq "/health/db" -and $j.db -ne "connected") {
      Write-Result "FAIL" $name "db not connected"
      continue
    }
    if ($path -eq "/health/queue" -and $j.queue -ne "PONG") {
      Write-Result "FAIL" $name "queue PONG missing (got $($j.queue))"
      continue
    }
    Write-Result "PASS" $name "HTTP 200 ok=true"
  }
  catch {
    Write-Result "FAIL" $name $_.Exception.Message
  }
}

# --- B) Guidance API ---
$gQuery =
  "clientAccountId=$([uri]::EscapeDataString($clientAccountId))" +
  "&locationId=$([uri]::EscapeDataString($locationId))" +
  "&nicheKey=$([uri]::EscapeDataString($nicheKey))" +
  "&lifecycleStage=$([uri]::EscapeDataString($lifecycleStage))"
$gUrl = "$apiBase/agent-workspace/v1/guidance?$gQuery"
try {
  $r = Invoke-WebRequest -Uri $gUrl -Method GET -Headers $wsHeaders -UseBasicParsing -TimeoutSec 90
  if ($r.StatusCode -eq 401) {
    Write-Result "FAIL" "api:guidance" "HTTP 401 (workspace key mismatch or wrong header)"
  }
  elseif ($r.StatusCode -eq 503) {
    Write-Result "FAIL" "api:guidance" "HTTP 503 (workspace key not configured on API)"
  }
  elseif ($r.StatusCode -ne 200) {
    Write-Result "FAIL" "api:guidance" "HTTP $($r.StatusCode)"
  }
  else {
    $j = $r.Content | ConvertFrom-Json
    if (-not $j.ok) {
      Write-Result "FAIL" "api:guidance" "ok is not true in body"
    }
    elseif ($null -eq $j.scripts) {
      Write-Result "FAIL" "api:guidance" "scripts missing (expect array; empty array ok if scope has no rows)"
    }
    elseif ($null -eq $j.objectionPlaybooks) {
      Write-Result "FAIL" "api:guidance" "objectionPlaybooks missing"
    }
    else {
      $scripts = @($j.scripts)
      $playbooks = @($j.objectionPlaybooks)
      $sc = $scripts.Count
      $oc = $playbooks.Count
      Write-Result "PASS" "api:guidance" "HTTP 200 scripts=$sc objectionPlaybooks=$oc"
    }
  }
}
catch {
  Write-Result "FAIL" "api:guidance" $_.Exception.Message
}

# --- C) admin-coc /agent-workspace (no login redirect) ---
$wsPath =
  "/agent-workspace?locationId=$([uri]::EscapeDataString($locationId))" +
  "&clientAccountId=$([uri]::EscapeDataString($clientAccountId))"
$wsUrl = "$cocBase$wsPath"
try {
  $r = Invoke-WebRequest -Uri $wsUrl -Method GET -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 90
  if ($r.StatusCode -ge 300 -and $r.StatusCode -lt 400) {
    $loc = $r.Headers["Location"]
    if ($loc -match "login") {
      Write-Result "FAIL" "coc:agent-workspace" "Redirect to login (HTTP $($r.StatusCode)); workspace should bypass admin password"
    }
    else {
      Write-Result "FAIL" "coc:agent-workspace" "Unexpected redirect HTTP $($r.StatusCode) Location=$loc"
    }
  }
  elseif ($r.StatusCode -ne 200) {
    Write-Result "FAIL" "coc:agent-workspace" "HTTP $($r.StatusCode)"
  }
  else {
    Write-Result "PASS" "coc:agent-workspace" "HTTP 200, not redirected to login"
  }
}
catch [System.Net.WebException] {
  $resp = $_.Exception.Response
  if ($null -ne $resp) {
    $code = [int]$resp.StatusCode
    $locHdr = $resp.Headers["Location"]
    if ($code -ge 300 -and $code -lt 400 -and $locHdr -match "login") {
      Write-Result "FAIL" "coc:agent-workspace" "Redirect to login (HTTP $code)"
    }
    else {
      Write-Result "FAIL" "coc:agent-workspace" "HTTP $code $($_.Exception.Message)"
    }
  }
  else {
    Write-Result "FAIL" "coc:agent-workspace" $_.Exception.Message
  }
}
catch {
  Write-Result "FAIL" "coc:agent-workspace" $_.Exception.Message
}

# --- D) CSP / iframe headers ---
function Get-Header-Dict {
  param($Response)
  $h = @{}
  foreach ($key in $Response.Headers.Keys) {
    $h[$key.ToLowerInvariant()] = $Response.Headers[$key]
  }
  return $h
}

# D1) /agent-workspace CSP + X-Frame-Options
$r = $null
try {
  $r = Invoke-WebRequest -Uri $wsUrl -Method HEAD -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 60
}
catch {
  $r = $null
}
if ($null -eq $r) {
  try {
    $r = Invoke-WebRequest -Uri $wsUrl -Method GET -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 60
  }
  catch {
    $r = $null
  }
}
if ($null -eq $r) {
  Write-Result "FAIL" "csp:agent-workspace" "could not fetch headers"
}
else {
  $hd = Get-Header-Dict $r
  $csp = $hd["content-security-policy"]
  $xfo = $hd["x-frame-options"]
  if ([string]::IsNullOrWhiteSpace($csp)) {
    Write-Result "FAIL" "csp:agent-workspace" "Content-Security-Policy header missing"
  }
  elseif ($csp -notmatch "frame-ancestors") {
    Write-Result "FAIL" "csp:agent-workspace" "CSP missing frame-ancestors directive"
  }
  else {
    if (-not [string]::IsNullOrWhiteSpace($expectedFrameAncestors)) {
      $tokens = $expectedFrameAncestors -split "\s+" | Where-Object { $_ }
      $missing = @()
      foreach ($t in $tokens) {
        if ($csp.IndexOf($t, [StringComparison]::OrdinalIgnoreCase) -lt 0) { $missing += $t }
      }
      if ($missing.Count -gt 0) {
        Write-Result "FAIL" "csp:agent-workspace-frame-ancestors" "EXPECTED_FRAME_ANCESTORS token(s) not found in CSP: $($missing -join ', ')"
      }
      else {
        Write-Result "PASS" "csp:agent-workspace-frame-ancestors" "all EXPECTED_FRAME_ANCESTORS tokens present"
      }
    }
    else {
      $hasGhl = $csp -match "app\.gohighlevel\.com"
      $hasLc = $csp -match "app\.leadconnectorhq\.com"
      if (-not $hasGhl -and -not $hasLc) {
        Write-Result "WARN" "csp:agent-workspace-frame-ancestors" "default GHL/LC hosts not found; set EXPECTED_FRAME_ANCESTORS if using white-label"
      }
      Write-Result "PASS" "csp:agent-workspace" "frame-ancestors present in CSP"
    }
  }
  if (-not [string]::IsNullOrWhiteSpace($xfo)) {
    $xf = $xfo.Trim().ToLowerInvariant()
    if ($xf -eq "deny" -or $xf -eq "sameorigin") {
      Write-Result "FAIL" "csp:x-frame-options" "X-Frame-Options=$xfo blocks typical GHL iframes (fix CDN / edge)"
    }
    else {
      Write-Result "WARN" "csp:x-frame-options" "X-Frame-Options=$xfo present (verify embed still works)"
    }
  }
  else {
    Write-Result "PASS" "csp:x-frame-options" "no X-Frame-Options (OK for iframe)"
  }
}

# D2) /api/agent-workspace/context — must not carry workspace document frame-ancestors from Next middleware
$ctxQuery =
  "clientAccountId=$([uri]::EscapeDataString($clientAccountId))" +
  "&locationId=$([uri]::EscapeDataString($locationId))"
$ctxUrl = "$cocBase/api/agent-workspace/context?$ctxQuery"
$r = $null
try {
  $r = Invoke-WebRequest -Uri $ctxUrl -Method HEAD -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 60
}
catch { $r = $null }
if ($null -eq $r) {
  try {
    $r = Invoke-WebRequest -Uri $ctxUrl -Method GET -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 60
  }
  catch {
    Write-Result "WARN" "csp:api-proxy-context" "could not fetch ($($_.Exception.Message)); skipping frame-ancestors check on proxy"
    $r = $null
  }
}
if ($null -ne $r) {
  $hd = Get-Header-Dict $r
  $csp = $hd["content-security-policy"]
  if (-not [string]::IsNullOrWhiteSpace($csp) -and ($csp -match "frame-ancestors")) {
    Write-Result "FAIL" "csp:api-proxy-context" "Content-Security-Policy contains frame-ancestors (unexpected for /api/agent-workspace/*; check edge/CDN)"
  }
  else {
    Write-Result "PASS" "csp:api-proxy-context" "no frame-ancestors in CSP (or no CSP header)"
  }
}

# D3) Protected route — not anonymously accessible as dashboard
$protUrl = "$cocBase$protectedRoute"
try {
  $r = Invoke-WebRequest -Uri $protUrl -Method GET -MaximumRedirection 0 -UseBasicParsing -TimeoutSec 60
  if ($r.StatusCode -ge 300 -and $r.StatusCode -lt 400) {
    $loc = $r.Headers["Location"]
    if ($loc -match "login") {
      Write-Result "PASS" "coc:protected-route" "HTTP $($r.StatusCode) redirect to login (protected)"
    }
    else {
      Write-Result "WARN" "coc:protected-route" "HTTP $($r.StatusCode) redirect Location=$loc (expected login gate)"
    }
  }
  elseif ($r.StatusCode -eq 401) {
    Write-Result "PASS" "coc:protected-route" "HTTP 401 (protected)"
  }
  elseif ($r.StatusCode -eq 200) {
    Write-Result "WARN" "coc:protected-route" "HTTP 200 without redirect - confirm this is not an unauthenticated dashboard shell"
  }
  else {
    Write-Result "WARN" "coc:protected-route" "HTTP $($r.StatusCode) (verify admin gate behavior)"
  }
}
catch [System.Net.WebException] {
  $resp = $_.Exception.Response
  if ($null -eq $resp) {
    Write-Result "FAIL" "coc:protected-route" $_.Exception.Message
  }
  else {
    $code = [int]$resp.StatusCode
    $loc = $resp.Headers["Location"]
    if (($code -ge 300 -and $code -lt 400) -and ($loc -match "login")) {
      Write-Result "PASS" "coc:protected-route" "HTTP $code redirect to login (protected)"
    }
    elseif ($code -eq 401) {
      Write-Result "PASS" "coc:protected-route" "HTTP 401 (protected)"
    }
    else {
      Write-Result "WARN" "coc:protected-route" "HTTP $code (verify admin gate behavior)"
    }
  }
}
catch {
  Write-Result "FAIL" "coc:protected-route" $_.Exception.Message
}

# --- E) Optional lifecycle webhook ---
if (-not $mutating) {
  Write-Result "SKIP" "mutate:lifecycle-webhook" "ALLOW_MUTATING_SMOKE_TESTS is not true"
}
elseif ([string]::IsNullOrWhiteSpace($webhookSecret)) {
  Write-Result "SKIP" "mutate:lifecycle-webhook" "SA360_WEBHOOK_SECRET missing"
}
else {
  $eventUuid = [guid]::NewGuid().ToString()
  $ts = [DateTimeOffset]::UtcNow.ToUnixTimeSeconds()
  $smokeLead = "smoke-agent-workspace-$ts-$($eventUuid.Substring(0, 8))"
  $payload = @{
    schema_version    = "1"
    client_account_id = $clientAccountId
    contact           = @{ lead_uid = $smokeLead }
    attribution       = @{}
    state             = @{ lifecycle_stage = $lifecycleStage }
    event             = @{
      event_uuid           = $eventUuid
      event_name_internal  = "lead_created"
      event_name_meta      = "Lead"
      event_time_unix      = $ts
      send_to_meta         = $false
    }
  } | ConvertTo-Json -Depth 8 -Compress
  try {
    $r = Invoke-WebRequest -Uri "$apiBase/webhooks/ghl/lifecycle-event" -Method POST `
      -Headers @{ "x-sa360-secret" = $webhookSecret; "Content-Type" = "application/json" } `
      -Body $payload -UseBasicParsing -TimeoutSec 90
    if ($r.StatusCode -ge 200 -and $r.StatusCode -lt 300) {
      Write-Result "PASS" "mutate:lifecycle-webhook" "HTTP $($r.StatusCode) event_uuid=$eventUuid lead_uid=$smokeLead send_to_meta=false"
    }
    else {
      Write-Result "FAIL" "mutate:lifecycle-webhook" "HTTP $($r.StatusCode)"
    }
  }
  catch {
    Write-Result "FAIL" "mutate:lifecycle-webhook" $_.Exception.Message
  }
}

# --- F) Optional What Happened ---
if (-not $mutating) {
  Write-Result "SKIP" "mutate:what-happened" "ALLOW_MUTATING_SMOKE_TESTS is not true"
}
elseif ([string]::IsNullOrWhiteSpace($contactId) -and [string]::IsNullOrWhiteSpace($leadUid)) {
  Write-Result "SKIP" "mutate:what-happened" "set SA360_GHL_CONTACT_ID or SA360_LEAD_UID for mutating test"
}
else {
  $body = @{
    clientAccountId = $clientAccountId
    locationId      = $locationId
    outcome         = "no_answer"
    notes           = "smoke-agent-workspace ps1"
  }
  if (-not [string]::IsNullOrWhiteSpace($contactId)) { $body.contactIdGhl = $contactId }
  if (-not [string]::IsNullOrWhiteSpace($leadUid)) { $body.leadUid = $leadUid }
  $json = $body | ConvertTo-Json -Compress
  try {
    $r = Invoke-WebRequest -Uri "$apiBase/agent-workspace/v1/actions/what-happened" -Method POST `
      -Headers @{ "x-sa360-workspace-key" = $workspaceKey; "Content-Type" = "application/json" } `
      -Body $json -UseBasicParsing -TimeoutSec 90
    if ($r.StatusCode -eq 201) {
      Write-Result "PASS" "mutate:what-happened" "HTTP 201 outcome=no_answer"
    }
    else {
      $snippet = if ($r.Content.Length -gt 200) { $r.Content.Substring(0, 200) + "..." } else { $r.Content }
      Write-Result "FAIL" "mutate:what-happened" "HTTP $($r.StatusCode) body=$snippet"
    }
  }
  catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($null -ne $resp) {
      $sr = New-Object System.IO.StreamReader($resp.GetResponseStream())
      $errBody = $sr.ReadToEnd()
      $sr.Close()
      $snippet = if ($errBody.Length -gt 200) { $errBody.Substring(0, 200) + "..." } else { $errBody }
      Write-Result "FAIL" "mutate:what-happened" "HTTP $([int]$resp.StatusCode) $snippet"
    }
    else {
      Write-Result "FAIL" "mutate:what-happened" $_.Exception.Message
    }
  }
  catch {
    Write-Result "FAIL" "mutate:what-happened" $_.Exception.Message
  }
}

# --- Negative webhook secret (only when mutating + secret present): expect 401 ---
if ($mutating -and -not [string]::IsNullOrWhiteSpace($webhookSecret)) {
  $badPayload = '{"schema_version":"1","client_account_id":"x","contact":{"lead_uid":"bad"},"attribution":{},"state":{},"event":{"event_uuid":"00000000-0000-0000-0000-000000000099","event_name_internal":"lead_created","event_name_meta":"Lead","send_to_meta":false}}'
  try {
    Invoke-WebRequest -Uri "$apiBase/webhooks/ghl/lifecycle-event" -Method POST `
      -Headers @{ "x-sa360-secret" = "definitely-not-the-real-secret"; "Content-Type" = "application/json" } `
      -Body $badPayload -UseBasicParsing -TimeoutSec 30 | Out-Null
    Write-Result "FAIL" "auth:webhook-negative" "expected 401 for wrong x-sa360-secret"
  }
  catch [System.Net.WebException] {
    $resp = $_.Exception.Response
    if ($null -eq $resp) {
      Write-Result "WARN" "auth:webhook-negative" $_.Exception.Message
    }
    else {
      $code = [int]$resp.StatusCode
      if ($code -eq 401) {
        Write-Result "PASS" "auth:webhook-negative" "HTTP 401 for wrong secret"
      }
      else {
        Write-Result "WARN" "auth:webhook-negative" "expected 401, got HTTP $code"
      }
    }
  }
  catch {
    Write-Result "WARN" "auth:webhook-negative" $_.Exception.Message
  }
}

Write-Host ""
Write-Host "Summary: failures=$($script:Failures) skips=$($script:Skips)"
if ($script:Failures -gt 0) {
  exit 1
}
exit 0

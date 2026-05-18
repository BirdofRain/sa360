# Automation Visibility — admin API testing (local / remote)

Use these steps to hit **`GET /admin/v1/automation-dashboard/*`** on the Fastify API directly (not through Next.js).

## Environment variables

| Variable | Required | Notes |
|----------|----------|--------|
| `SA360_API_BASE_URL` | **Yes** | Fastify root URL, e.g. `http://localhost:3001`. Same origin you configure for admin-coc as `NEXT_PUBLIC_SA360_API_BASE_URL` or `NEXT_PUBLIC_API_BASE_URL` (no trailing slash). |
| `SA360_ADMIN_API_KEY` **or** `ADMIN_API_KEY` **or** `SA360_ADMIN_KEY` | **Yes** | Sent as header `x-sa360-admin-key`. Must match the API process (`ADMIN_API_KEY` / `SA360_ADMIN_KEY`). |
| `SA360_CLIENT_ACCOUNT_ID` | No | If set, appended as `clientAccountId` on every request. |
| `RANGE` | No | Preset window: `today`, `7d`, or `30d`. Default **`7d`**. |

Optional query params supported by the API (not set by the helper script unless you extend it): `locationId`, `nicheKey`, `from`, `to`.

## Why PowerShell failed with `NullReferenceException`

If **`SA360_ADMIN_API_KEY`** (and the fallbacks) are **unset or empty**, this pattern breaks:

```powershell
$h = @{ "x-sa360-admin-key" = $env:SA360_ADMIN_API_KEY }
Invoke-RestMethod ... -Headers $h
```

The header value is `$null`. Depending on PowerShell / .NET versions, `Invoke-RestMethod` can throw an internal **NullReferenceException** instead of a clear “missing header” error.

**Fix:** Resolve the key with null/whitespace checks **before** building the hashtable (see snippet and script below).

## Endpoints exercised

| Path | Purpose |
|------|---------|
| `/admin/v1/automation-dashboard/summary` | Summary counts / funnel |
| `/admin/v1/automation-dashboard/workflow-progression` | Workflow funnel |
| `/admin/v1/automation-dashboard/appointments` | Appointments slice |
| `/admin/v1/automation-dashboard/signal-health` | Signal health |
| `/admin/v1/automation-dashboard/accounts` | Accounts slice |

## Recommended: helper script (never prints the key)

From the **repository root**:

```powershell
.\scripts\test-automation-dashboard-api.ps1
```

Set env vars first in the same session (or System Properties → Environment). **Do not** paste keys into chat logs or committed files.

### Expected output (shape)

With a healthy API and valid key you should see five blocks similar to:

```text
=== GET .../automation-dashboard/summary?range=7d ===
Status: 200
Body (JSON, depth 6):
{ ... }

=== GET .../automation-dashboard/workflow-progression?range=7d ===
Status: 200
...

--- Done: 5 request(s), 0 failure(s). ---
```

On missing key:

```text
ERROR: No admin API key found. Set one of: SA360_ADMIN_API_KEY, ADMIN_API_KEY, SA360_ADMIN_KEY (non-empty). The key is never printed by this script.
```

Exit code **1** if any request fails or configuration is invalid.

## Inline PowerShell snippet (copy-paste)

Safe header construction and all five GETs. **Does not echo the key.**

```powershell
$ErrorActionPreference = "Stop"

function Get-EnvTrim([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($v)) { return $null }
  return $v.Trim()
}

$baseUrl = Get-EnvTrim "SA360_API_BASE_URL"
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
  Write-Error "SA360_API_BASE_URL is required (e.g. http://localhost:3001)."
  exit 1
}
$baseUrl = $baseUrl.TrimEnd("/")

$adminKey =
  (Get-EnvTrim "SA360_ADMIN_API_KEY"),
  (Get-EnvTrim "ADMIN_API_KEY"),
  (Get-EnvTrim "SA360_ADMIN_KEY") |
  Where-Object { $_ } |
  Select-Object -First 1

if ([string]::IsNullOrWhiteSpace($adminKey)) {
  Write-Error "Set SA360_ADMIN_API_KEY, ADMIN_API_KEY, or SA360_ADMIN_KEY (non-empty) before calling the admin API."
  exit 1
}

$range = Get-EnvTrim "RANGE"
if ([string]::IsNullOrWhiteSpace($range)) { $range = "7d" }
if ($range -notin @("today", "7d", "30d")) {
  Write-Error "RANGE must be today, 7d, or 30d."
  exit 1
}

$clientAccountId = Get-EnvTrim "SA360_CLIENT_ACCOUNT_ID"
$query = "range=$([uri]::EscapeDataString($range))"
if (-not [string]::IsNullOrWhiteSpace($clientAccountId)) {
  $query += "&clientAccountId=$([uri]::EscapeDataString($clientAccountId))"
}

$headers = @{ "x-sa360-admin-key" = $adminKey }
$paths = @(
  "/admin/v1/automation-dashboard/summary",
  "/admin/v1/automation-dashboard/workflow-progression",
  "/admin/v1/automation-dashboard/appointments",
  "/admin/v1/automation-dashboard/signal-health",
  "/admin/v1/automation-dashboard/accounts"
)

foreach ($p in $paths) {
  $uri = "$baseUrl$p`?$query"
  Write-Host "`n=== GET $uri ===" -ForegroundColor Cyan
  try {
    $resp = Invoke-WebRequest -Uri $uri -Headers $headers -Method GET -UseBasicParsing
    Write-Host "Status: $($resp.StatusCode)"
    $json = $resp.Content | ConvertFrom-Json
    Write-Host ($json | ConvertTo-Json -Depth 6)
  }
  catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    exit 1
  }
}
```

## Implementation references

- Routes: `apps/api/src/routes/automation-dashboard.ts`
- Query schema: `apps/api/src/schemas/automation-dashboard.schema.ts`

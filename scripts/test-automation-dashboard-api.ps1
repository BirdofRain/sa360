#Requires -Version 5.1
<#
.SYNOPSIS
  Read-only checks for Automation Visibility admin endpoints (/admin/v1/automation-dashboard/*).

.DESCRIPTION
  Required environment variables:
    - SA360_API_BASE_URL (Fastify root, e.g. http://localhost:3001)
    - One of: SA360_ADMIN_API_KEY, ADMIN_API_KEY, SA360_ADMIN_KEY (non-empty)

  Optional:
    - SA360_CLIENT_ACCOUNT_ID — adds clientAccountId query param
    - RANGE — today | 7d | 30d (default 7d)

  Secrets are never printed. Exit code 1 if configuration is invalid or any HTTP request fails.
#>

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Get-EnvTrim([string]$Name) {
  $v = [Environment]::GetEnvironmentVariable($Name, "Process")
  if ([string]::IsNullOrWhiteSpace($v)) { return $null }
  return $v.Trim()
}

function Resolve-AdminApiKey {
  foreach ($name in @("SA360_ADMIN_API_KEY", "ADMIN_API_KEY", "SA360_ADMIN_KEY")) {
    $candidate = Get-EnvTrim $name
    if (-not [string]::IsNullOrWhiteSpace($candidate)) {
      return $candidate
    }
  }
  return $null
}

$baseUrl = Get-EnvTrim "SA360_API_BASE_URL"
if ([string]::IsNullOrWhiteSpace($baseUrl)) {
  Write-Host "ERROR: SA360_API_BASE_URL is required (Fastify base URL, e.g. http://localhost:3001)." -ForegroundColor Red
  exit 1
}
$baseUrl = $baseUrl.TrimEnd("/")

$adminKey = Resolve-AdminApiKey
if ([string]::IsNullOrWhiteSpace($adminKey)) {
  Write-Host "ERROR: No admin API key found. Set one of: SA360_ADMIN_API_KEY, ADMIN_API_KEY, SA360_ADMIN_KEY (non-empty)." -ForegroundColor Red
  Write-Host "The key is never printed by this script." -ForegroundColor DarkYellow
  exit 1
}

$range = Get-EnvTrim "RANGE"
if ([string]::IsNullOrWhiteSpace($range)) { $range = "7d" }
if ($range -notin @("today", "7d", "30d")) {
  Write-Host "ERROR: RANGE must be today, 7d, or 30d (got: $range)." -ForegroundColor Red
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

$failures = 0
foreach ($p in $paths) {
  $uri = "$baseUrl$p`?$query"
  Write-Host ""
  Write-Host "=== GET $uri ===" -ForegroundColor Cyan
  try {
    $resp = Invoke-WebRequest -Uri $uri -Headers $headers -Method GET -UseBasicParsing
    Write-Host "Status: $($resp.StatusCode)" -ForegroundColor Green
    try {
      $json = $resp.Content | ConvertFrom-Json
      Write-Host "Body (JSON, depth 6):"
      $text = $json | ConvertTo-Json -Depth 6
      $max = 8000
      if ($text.Length -gt $max) {
        Write-Host ($text.Substring(0, $max))
        Write-Host "... (truncated; total $($text.Length) characters)" -ForegroundColor DarkGray
      }
      else {
        Write-Host $text
      }
    }
    catch {
      Write-Host "Body (non-JSON or parse error): $($resp.Content.Substring(0, [Math]::Min(500, $resp.Content.Length)))"
    }
  }
  catch {
    Write-Host "Request failed: $($_.Exception.Message)" -ForegroundColor Red
    $resp = $null
    if ($_.Exception.Response -ne $null) {
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $body = $reader.ReadToEnd()
        if (-not [string]::IsNullOrWhiteSpace($body)) {
          Write-Host "Response body: $($body.Substring(0, [Math]::Min(800, $body.Length)))" -ForegroundColor DarkYellow
        }
      }
      catch { }
    }
    $failures++
  }
}

Write-Host ""
if ($failures -eq 0) {
  Write-Host "--- Done: $($paths.Count) request(s), 0 failure(s). ---" -ForegroundColor Green
  exit 0
}
else {
  Write-Host "--- Done: $($paths.Count) request(s), $failures failure(s). ---" -ForegroundColor Red
  exit 1
}

# Smoke: GHL OAuth callback must not 404 on API host (and optional admin-coc proxy host).
param(
  [string]$ApiBase = "https://sa360-sw6oq.ondigitalocean.app",
  [string]$CocBase = "https://sa360-api-staging-coo57.ondigitalocean.app"
)

function Invoke-Smoke($Label, $Url) {
  Write-Host "`n=== $Label ===" -ForegroundColor Cyan
  Write-Host $Url
  try {
    $resp = Invoke-WebRequest -Uri $Url -MaximumRedirection 0 -SkipHttpErrorCheck
    Write-Host "Status: $($resp.StatusCode)"
    if ($resp.Headers.Location) { Write-Host "Location: $($resp.Headers.Location)" }
    if ($resp.StatusCode -eq 404) {
      Write-Host "FAIL: got 404" -ForegroundColor Red
      exit 1
    }
    if ($resp.StatusCode -ge 300 -and $resp.StatusCode -lt 400) {
      Write-Host "OK: redirect (expected)" -ForegroundColor Green
    } elseif ($resp.StatusCode -eq 400) {
      Write-Host "OK: controlled 400 JSON" -ForegroundColor Green
    } else {
      Write-Host "OK: status $($resp.StatusCode)" -ForegroundColor Green
    }
  } catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
    exit 1
  }
}

Invoke-Smoke "API callback (canonical)" "$ApiBase/integrations/oauth/callback"
Invoke-Smoke "API callback with code only" "$ApiBase/integrations/oauth/callback?code=smoke-test"
Invoke-Smoke "admin-coc callback proxy" "$CocBase/integrations/oauth/callback"

Write-Host "`nAll OAuth callback smoke checks passed." -ForegroundColor Green

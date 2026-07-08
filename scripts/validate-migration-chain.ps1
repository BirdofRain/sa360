# Disposable local PostgreSQL migration-chain validation.
# Requires: sa360-postgres container on 127.0.0.1:5432
# Usage: .\scripts\validate-migration-chain.ps1 [-IncludeFulfillmentShadow]

param(
  [switch]$IncludeFulfillmentShadow
)

$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$BaseUrl = "postgresql://sa360:sa360password@127.0.0.1:5432"
$Databases = @(
  "sa360_migration_fresh_test",
  "sa360_migration_upgrade_test",
  "sa360_migration_idempotency_test"
)

function Reset-Database($Name) {
  docker exec sa360-postgres psql -U sa360 -d postgres -c "DROP DATABASE IF EXISTS `"$Name`";" | Out-Null
  docker exec sa360-postgres psql -U sa360 -d postgres -c "CREATE DATABASE `"$Name`";" | Out-Null
}

function Invoke-MigrateDeploy($Database) {
  $env:DATABASE_URL = "$BaseUrl/$Database"
  pnpm exec prisma migrate deploy 2>&1
}

Write-Host "=== Validation A: fresh database ==="
Reset-Database "sa360_migration_fresh_test"
$fresh = Invoke-MigrateDeploy "sa360_migration_fresh_test"
if ($LASTEXITCODE -ne 0) { throw "Fresh migrate deploy failed" }
$fresh | Select-String -Pattern "Applying|successfully|Error" | ForEach-Object { $_.Line }

$env:DATABASE_URL = "$BaseUrl/sa360_migration_fresh_test"
pnpm exec prisma validate | Out-Null
pnpm exec prisma generate | Out-Null

docker exec sa360-postgres psql -U sa360 -d sa360_migration_fresh_test -c `
  "SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'ClientGhlDestination' AND column_name = 'sa360CustomFieldOptionMapJson';"

Write-Host "=== Validation B: upgrade database (pre-reconciliation ledger) ==="
Reset-Database "sa360_migration_upgrade_test"
$env:DATABASE_URL = "$BaseUrl/sa360_migration_upgrade_test"
Invoke-MigrateDeploy "sa360_migration_upgrade_test" | Out-Null

$seed = @"
INSERT INTO "ClientAccount" ("clientAccountId","clientDisplayName","status","updatedAt")
VALUES ('legacy_client_001','Legacy Client','active',NOW());
INSERT INTO "ClientGhlDestination" ("id","clientAccountId","destinationSubaccountIdGhl","sa360CustomFieldOptionMapJson","updatedAt")
VALUES ('dest_001','legacy_client_001','loc_123','{"state":"TX"}'::jsonb,NOW());
"@
$seed | docker exec -i sa360-postgres psql -U sa360 -d sa360_migration_upgrade_test -v ON_ERROR_STOP=1 | Out-Null
docker exec sa360-postgres psql -U sa360 -d sa360_migration_upgrade_test -c `
  "DELETE FROM _prisma_migrations WHERE migration_name = '20260601170000_reconcile_client_ghl_destination_option_map';" | Out-Null

Invoke-MigrateDeploy "sa360_migration_upgrade_test" | Out-Null
docker exec sa360-postgres psql -U sa360 -d sa360_migration_upgrade_test -c `
  "SELECT id, sa360CustomFieldOptionMapJson FROM ClientGhlDestination WHERE id = 'dest_001';"

Write-Host "=== Validation C: idempotent second deploy ==="
Reset-Database "sa360_migration_idempotency_test"
Invoke-MigrateDeploy "sa360_migration_idempotency_test" | Out-Null
$second = Invoke-MigrateDeploy "sa360_migration_idempotency_test"
if ($second -notmatch "No pending migrations") {
  if ($second -notmatch "already applied" -and $second -notmatch "successfully applied") {
    Write-Warning "Second deploy output: $second"
  }
}
docker exec sa360-postgres psql -U sa360 -d sa360_migration_idempotency_test -c `
  "SELECT migration_name, finished_at IS NOT NULL AS finished FROM _prisma_migrations ORDER BY finished_at;"

if ($IncludeFulfillmentShadow) {
  $fulfillmentDir = "prisma/migrations/20260708180000_fulfillment_shadow_core_v1"
  if (Test-Path $fulfillmentDir) {
    Write-Host "=== Optional: fulfillment shadow-core migration ==="
    $env:DATABASE_URL = "$BaseUrl/sa360_migration_fresh_test"
    Invoke-MigrateDeploy "sa360_migration_fresh_test" | Out-Null
  }
}

Write-Host "Migration chain validation complete."

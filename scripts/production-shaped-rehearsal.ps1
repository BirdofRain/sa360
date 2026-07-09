# Disposable production-shaped LF2 migration rehearsal (local Docker only).
$ErrorActionPreference = "Stop"
$RepoRoot = Split-Path -Parent $PSScriptRoot
Set-Location $RepoRoot

$DbName = "sa360_production_rehearsal"
$BaseUrl = "postgresql://sa360:sa360password@127.0.0.1:5432"

# Prevent repo .env from redirecting Prisma to production.
Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
Remove-Item Env:DIRECT_URL -ErrorAction SilentlyContinue
$Pending = @(
  "20260601170000_reconcile_client_ghl_destination_option_map",
  "20260708180000_fulfillment_shadow_core_v1",
  "20260709120000_lf2_reservation_enums_v1",
  "20260709121000_lf2_reservation_delivery_attempt_v1"
)

function Invoke-NativeChecked {
  param(
    [Parameter(Mandatory)]
    [scriptblock]$Command,
    [Parameter(Mandatory)]
    [string]$Description,
    [switch]$SuppressOutput,
    [object[]]$ArgumentList
  )

  $previousPreference = $ErrorActionPreference
  try {
    $ErrorActionPreference = "Continue"
    if ($ArgumentList) {
      $output = & $Command @ArgumentList 2>&1
    }
    else {
      $output = & $Command 2>&1
    }
    $exitCode = $LASTEXITCODE
  }
  finally {
    $ErrorActionPreference = $previousPreference
  }

  if (-not $SuppressOutput) {
    $output | ForEach-Object { Write-Host $_ }
  }

  if ($null -eq $exitCode) {
    $exitCode = 0
  }

  if ($exitCode -ne 0) {
    throw "$Description failed with exit code $exitCode"
  }

  return $output
}

function Reset-Database($Name) {
  Invoke-NativeChecked -Description "Drop database $Name" -SuppressOutput -Command {
    param($TargetName)
    docker exec sa360-postgres psql -U sa360 -d postgres -c "DROP DATABASE IF EXISTS `"$TargetName`";"
  } -ArgumentList $Name | Out-Null

  Invoke-NativeChecked -Description "Create database $Name" -SuppressOutput -Command {
    param($TargetName)
    docker exec sa360-postgres psql -U sa360 -d postgres -c "CREATE DATABASE `"$TargetName`";"
  } -ArgumentList $Name | Out-Null
}

Write-Host "=== Step 1: Fresh deploy all migrations (full chain validation) ==="
Reset-Database "sa360_migration_full_chain"
$env:DATABASE_URL = "$BaseUrl/sa360_migration_full_chain"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
$fullDeployOut = Invoke-NativeChecked -Description "Full chain migrate deploy" -Command {
  pnpm exec prisma migrate deploy
}
$fullDeployMs = $sw.ElapsedMilliseconds

Write-Host "=== Step 2: Production-shaped DB (41 applied, 4 pending) ==="
Reset-Database $DbName
$env:DATABASE_URL = "$BaseUrl/$DbName"
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
Invoke-NativeChecked -Description "Initial full deploy for prod-shaped setup" -SuppressOutput -Command {
  pnpm exec prisma migrate deploy
} | Out-Null
$initialDeployMs = $sw2.ElapsedMilliseconds

foreach ($name in $Pending) {
  Invoke-NativeChecked -Description "Remove pending migration record $name" -SuppressOutput -Command {
    param($MigrationName, $DatabaseName)
    docker exec sa360-postgres psql -U sa360 -d $DatabaseName -c "DELETE FROM _prisma_migrations WHERE migration_name = '$MigrationName';"
  } -ArgumentList $name, $DbName | Out-Null
}

# Drop LF2 schema objects to mirror production absence
$dropSql = @"
DROP TABLE IF EXISTS "DeliveryAttempt" CASCADE;
DROP TABLE IF EXISTS "DeliveryInstruction" CASCADE;
DROP TABLE IF EXISTS "LeadAllocation" CASCADE;
DROP TABLE IF EXISTS "FulfillmentOutbox" CASCADE;
DROP TABLE IF EXISTS "LeadEligibilityAssessment" CASCADE;
DROP TABLE IF EXISTS "DeliveryTarget" CASCADE;
ALTER TABLE "LeadOrder"
  DROP COLUMN IF EXISTS "orderKind",
  DROP COLUMN IF EXISTS "fulfillmentMode",
  DROP COLUMN IF EXISTS "requestedQuantity",
  DROP COLUMN IF EXISTS "fulfillmentCycleStart",
  DROP COLUMN IF EXISTS "fulfillmentCycleEnd",
  DROP COLUMN IF EXISTS "allowedSourceLanesJson",
  DROP COLUMN IF EXISTS "proofPolicyKey",
  DROP COLUMN IF EXISTS "exclusivityRequired",
  DROP COLUMN IF EXISTS "fulfillmentPriority",
  DROP COLUMN IF EXISTS "proposedQuantity",
  DROP COLUMN IF EXISTS "reservedQuantity",
  DROP COLUMN IF EXISTS "fulfilledQuantity";
DROP TYPE IF EXISTS "DeliveryAttemptStatus";
DROP TYPE IF EXISTS "DeliveryAttemptMode";
DROP TYPE IF EXISTS "LeadOrderKind";
DROP TYPE IF EXISTS "LeadFulfillmentMode";
DROP TYPE IF EXISTS "LeadEligibilityStatus";
DROP TYPE IF EXISTS "LeadAllocationStatus";
DROP TYPE IF EXISTS "DeliveryInstructionStatus";
DROP TYPE IF EXISTS "FulfillmentOutboxStatus";
"@
Invoke-NativeChecked -Description "Drop LF2 schema objects for production-shaped state" -SuppressOutput -Command {
  param($Sql, $DatabaseName)
  $Sql | docker exec -i sa360-postgres psql -U sa360 -d $DatabaseName -v ON_ERROR_STOP=1
} -ArgumentList $dropSql, $DbName | Out-Null

Write-Host "=== Step 3: Seed production-shaped legacy data ==="
$seed = @"
INSERT INTO "ClientAccount" ("clientAccountId","clientDisplayName","status","updatedAt")
VALUES ('smart_agent_360_demo_2','Smart Agent 360 Demo','active',NOW())
ON CONFLICT DO NOTHING;
INSERT INTO "ClientGhlDestination" (
  "id","clientAccountId","destinationSubaccountIdGhl","locationName",
  "ghlConnectionStatus","snapshotInstalled","requiredFieldsInstalled",
  "deliveryMode","deliveryEnabled","clientCutoverApproved","internalApprovalStatus","updatedAt"
) VALUES (
  'rehearsal_dest_001','smart_agent_360_demo_2','VPuMIhN6JpxdoXvvlekZ','Smart Agent 360 Demo',
  'connected',true,true,'shadow',false,true,'approved',NOW()
) ON CONFLICT DO NOTHING;
INSERT INTO "LeadOrder" (
  "id","orderNumber","clientAccountId","clientDisplayName","status","nicheKey","productType",
  "statesJson","leadVolume","campaignType","crmPackage","aiVoiceAddon","createdByRole",
  "submittedAt","createdAt","updatedAt"
) VALUES (
  'rehearsal_order_001','LO-1043','unassigned','Test Client','submitted','Vet','Final Expense',
  '["TX"]'::jsonb,100,'Fresh leads','GHL Starter',true,'admin',
  NOW(),NOW(),NOW()
) ON CONFLICT DO NOTHING;
INSERT INTO "SourceLeadEvent" (
  "id","sourceLeadUid","sourceProvider","sourceSystem","sourceType","rawPayloadJson",
  "clientAccountIdResolved","status","normalizedPayloadJson","enrichmentMetadataJson","createdAt","updatedAt"
) VALUES (
  'rehearsal_lead_001','rehearsal-lead-uid-001','manual_import','csv_import','manual_entry','{}'::jsonb,
  'smart_agent_360_demo_2','routing_matched',
  '{"phone_e164":"+12025550155","email":"rehearsal@example.test","contact":{"firstName":"R","lastName":"H"}}'::jsonb,
  '{"sourceLane":"manual_import_csv_import"}'::jsonb,NOW(),NOW()
) ON CONFLICT DO NOTHING;
"@
Invoke-NativeChecked -Description "Seed production-shaped legacy data" -SuppressOutput -Command {
  param($Sql, $DatabaseName)
  $Sql | docker exec -i sa360-postgres psql -U sa360 -d $DatabaseName -v ON_ERROR_STOP=1
} -ArgumentList $seed, $DbName | Out-Null

$beforeCountsSql = @'
SELECT 'LeadOrder='||count(*) FROM "LeadOrder";
SELECT 'ClientGhlDestination='||count(*) FROM "ClientGhlDestination";
SELECT 'SourceLeadEvent='||count(*) FROM "SourceLeadEvent";
SELECT 'migrations='||count(*) FROM _prisma_migrations;
'@

$beforeCounts = Invoke-NativeChecked -Description "Read before-migration counts" -Command {
  param($DatabaseName, $Sql)
  $Sql | docker exec -i sa360-postgres psql -U sa360 -d $DatabaseName -At
} -ArgumentList $DbName, $beforeCountsSql

Write-Host "=== Step 4: Apply pending 4 migrations (production deploy) ==="
$sw3 = [System.Diagnostics.Stopwatch]::StartNew()
$deployOut = Invoke-NativeChecked -Description "Pending migration deploy" -Command {
  pnpm exec prisma migrate deploy
}
$pendingDeployMs = $sw3.ElapsedMilliseconds

$afterCountsSql = @'
SELECT 'LeadOrder='||count(*) FROM "LeadOrder";
SELECT 'LeadAllocation='||count(*) FROM "LeadAllocation";
SELECT 'DeliveryTarget='||count(*) FROM "DeliveryTarget";
SELECT 'migrations='||count(*) FROM _prisma_migrations;
'@

$afterCounts = Invoke-NativeChecked -Description "Read after-migration counts" -Command {
  param($DatabaseName, $Sql)
  $Sql | docker exec -i sa360-postgres psql -U sa360 -d $DatabaseName -At
} -ArgumentList $DbName, $afterCountsSql

Write-Host "=== Step 5: Second migrate deploy (idempotency) ==="
Invoke-NativeChecked -Description "Second migrate deploy (idempotency)" -Command {
  pnpm exec prisma migrate deploy
} | Out-Null

Write-Host "=== Step 6: Builds ==="
Invoke-NativeChecked -Description "Prisma validate" -Command { pnpm exec prisma validate } | Out-Null
Invoke-NativeChecked -Description "Prisma generate" -Command { pnpm exec prisma generate } | Out-Null
Invoke-NativeChecked -Description "Build @sa360/shared" -Command { pnpm --filter @sa360/shared build } | Out-Null
Invoke-NativeChecked -Description "Build @sa360/api" -Command { pnpm --filter @sa360/api build } | Out-Null
Invoke-NativeChecked -Description "Build @sa360/worker" -Command { pnpm --filter @sa360/worker build } | Out-Null
Invoke-NativeChecked -Description "Build @sa360/admin-coc" -Command { pnpm --filter @sa360/admin-coc build } | Out-Null

Write-Host "=== Step 7: Focused tests ==="
Invoke-NativeChecked -Description "Focused fulfillment tests" -Command {
  pnpm --filter @sa360/api exec node --import tsx --test src/test/migration-chain.guard.test.ts src/services/fulfillment-execution/fulfillment-execution.hardening.test.ts src/services/fulfillment-execution/fulfillment-ghl-canary-gates.service.test.ts
} | Out-Null

$legacyOrderSql = @'
SELECT "orderNumber", status, "clientAccountId", "requestedQuantity", "reservedQuantity"
FROM "LeadOrder"
WHERE id='rehearsal_order_001';
'@

$legacyOrder = Invoke-NativeChecked -Description "Read legacy LeadOrder after migration" -Command {
  param($DatabaseName, $Sql)
  $Sql | docker exec -i sa360-postgres psql -U sa360 -d $DatabaseName -At
} -ArgumentList $DbName, $legacyOrderSql

Write-Host "=== REHEARSAL SUMMARY ==="
Write-Host "Full chain deploy ms: $fullDeployMs"
Write-Host "Initial prod-shaped deploy ms: $initialDeployMs"
Write-Host "Pending 4 deploy ms: $pendingDeployMs"
Write-Host "Before counts: $beforeCounts"
Write-Host "After counts: $afterCounts"
Write-Host "Legacy LeadOrder after migration: $legacyOrder"

if ($legacyOrder -notmatch "LO-1043") {
  throw "Legacy LeadOrder LO-1043 not preserved after migration"
}

Write-Host "=== REHEARSAL PASSED ==="

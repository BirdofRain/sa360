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

function Reset-Database($Name) {
  docker exec sa360-postgres psql -U sa360 -d postgres -c "DROP DATABASE IF EXISTS `"$Name`";" | Out-Null
  docker exec sa360-postgres psql -U sa360 -d postgres -c "CREATE DATABASE `"$Name`";" | Out-Null
}

Write-Host "=== Step 1: Fresh deploy all migrations (full chain validation) ==="
Reset-Database "sa360_migration_full_chain"
$env:DATABASE_URL = "$BaseUrl/sa360_migration_full_chain"
$sw = [System.Diagnostics.Stopwatch]::StartNew()
pnpm exec prisma migrate deploy 2>&1 | Tee-Object -Variable fullDeployOut
$fullDeployMs = $sw.ElapsedMilliseconds
if ($LASTEXITCODE -ne 0) { throw "Full chain migrate deploy failed" }

Write-Host "=== Step 2: Production-shaped DB (41 applied, 4 pending) ==="
Reset-Database $DbName
$env:DATABASE_URL = "$BaseUrl/$DbName"
$sw2 = [System.Diagnostics.Stopwatch]::StartNew()
pnpm exec prisma migrate deploy 2>&1 | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Initial full deploy failed for prod-shaped setup" }

foreach ($name in $Pending) {
  docker exec sa360-postgres psql -U sa360 -d $DbName -c "DELETE FROM _prisma_migrations WHERE migration_name = '$name';" | Out-Null
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
$dropSql | docker exec -i sa360-postgres psql -U sa360 -d $DbName -v ON_ERROR_STOP=1 | Out-Null

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
$seed | docker exec -i sa360-postgres psql -U sa360 -d $DbName -v ON_ERROR_STOP=1 | Out-Null

$beforeCounts = docker exec sa360-postgres psql -U sa360 -d $DbName -Atc "SELECT 'LeadOrder='||count(*) FROM \"LeadOrder\"; SELECT 'ClientGhlDestination='||count(*) FROM \"ClientGhlDestination\"; SELECT 'SourceLeadEvent='||count(*) FROM \"SourceLeadEvent\"; SELECT 'migrations='||count(*) FROM _prisma_migrations;"

Write-Host "=== Step 4: Apply pending 4 migrations (production deploy) ==="
$sw3 = [System.Diagnostics.Stopwatch]::StartNew()
$deployOut = pnpm exec prisma migrate deploy 2>&1
$pendingDeployMs = $sw3.ElapsedMilliseconds
$deployOut | ForEach-Object { $_ }
if ($LASTEXITCODE -ne 0) { throw "Pending migration deploy failed" }

$afterCounts = docker exec sa360-postgres psql -U sa360 -d $DbName -Atc "SELECT 'LeadOrder='||count(*) FROM \"LeadOrder\"; SELECT 'LeadAllocation='||count(*) FROM \"LeadAllocation\"; SELECT 'DeliveryTarget='||count(*) FROM \"DeliveryTarget\"; SELECT 'migrations='||count(*) FROM _prisma_migrations;"

Write-Host "=== Step 5: Second migrate deploy (idempotency) ==="
$second = pnpm exec prisma migrate deploy 2>&1
$second | ForEach-Object { $_ }
if ($LASTEXITCODE -ne 0) { throw "Second migrate deploy failed" }

Write-Host "=== Step 6: Builds ==="
pnpm exec prisma validate
pnpm exec prisma generate
pnpm --filter @sa360/shared build
pnpm --filter @sa360/api build
pnpm --filter @sa360/worker build
pnpm --filter @sa360/admin-coc build

Write-Host "=== Step 7: Focused tests ==="
pnpm --filter @sa360/api exec node --import tsx --test src/test/migration-chain.guard.test.ts src/services/fulfillment-execution/fulfillment-execution.hardening.test.ts src/services/fulfillment-execution/fulfillment-ghl-canary-gates.service.test.ts

$legacyOrder = docker exec sa360-postgres psql -U sa360 -d $DbName -Atc "SELECT \"orderNumber\", status, \"clientAccountId\", \"requestedQuantity\", \"reservedQuantity\" FROM \"LeadOrder\" WHERE id='rehearsal_order_001';"

Write-Host "=== REHEARSAL SUMMARY ==="
Write-Host "Full chain deploy ms: $fullDeployMs"
Write-Host "Pending 4 deploy ms: $pendingDeployMs"
Write-Host "Before counts: $beforeCounts"
Write-Host "After counts: $afterCounts"
Write-Host "Legacy LeadOrder after migration: $legacyOrder"

-- Read-only delivery health incidents and an independent scanner heartbeat.
--
-- Empty tables only. No SourceLeadEvent, CompanySheetsDispatchIntent,
-- CompanySheetsDeliveryJob, CompanySheetsDeliveryRow, WebhookRequestLog,
-- routing, or destination row is inserted or updated.
-- No delivery flag changes. There is no backfill.
-- Routing, ingestion, and Company Sheets execution do not read these tables.
--
-- DeliveryHealthIncident_open_client_class_key is a partial unique index.
-- Prisma 6 cannot model that filter. Do not drop the index in a later diff.
--
-- This script owns its transaction. BEGIN is the first statement and COMMIT is
-- the last. SET LOCAL lock_timeout applies only inside this transaction.
-- The new tables have no foreign keys, so this migration does not validate
-- existing delivery rows.
--
-- Merging this file makes sa360-migrate apply it on the next API predeploy.
-- SA360_DELIVERY_HEALTH_MONITOR_ENABLED and
-- SA360_DELIVERY_HEALTH_NOTIFY_ENABLED stay unset. Existing readers do not
-- reference these tables until those flags are the exact string true.

BEGIN;

SET LOCAL lock_timeout = '3s';

CREATE TABLE "DeliveryHealthIncident" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "failureClass" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "firstSeenAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "lastNotifiedAt" TIMESTAMP(3),
    "lastNotificationKind" TEXT,
    "lastNotificationKey" TEXT,
    "lastNotifiedSeverity" TEXT,
    "affectedCount" INTEGER NOT NULL DEFAULT 0,
    "acknowledgedAt" TIMESTAMP(3),
    "resolvedAt" TIMESTAMP(3),
    "evidenceJson" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryHealthIncident_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "DeliveryHealthIncident_severity_check" CHECK ("severity" IN ('warning', 'critical')),
    CONSTRAINT "DeliveryHealthIncident_status_check" CHECK ("status" IN ('open', 'acknowledged', 'resolved'))
);

CREATE INDEX "DeliveryHealthIncident_client_class_idx"
    ON "DeliveryHealthIncident"("clientAccountId", "failureClass", "resolvedAt");

CREATE INDEX "DeliveryHealthIncident_status_seen_idx"
    ON "DeliveryHealthIncident"("status", "lastSeenAt");

CREATE UNIQUE INDEX "DeliveryHealthIncident_open_client_class_key"
    ON "DeliveryHealthIncident"("clientAccountId", "failureClass")
    WHERE "resolvedAt" IS NULL;

CREATE TABLE "DeliveryHealthMonitorHeartbeat" (
    "id" TEXT NOT NULL,
    "lastStartedAt" TIMESTAMP(3),
    "lastSucceededAt" TIMESTAMP(3),
    "lastFailedAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "lastMonitorNotifiedAt" TIMESTAMP(3),
    "lastMonitorNotificationKey" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DeliveryHealthMonitorHeartbeat_pkey" PRIMARY KEY ("id")
);

COMMIT;

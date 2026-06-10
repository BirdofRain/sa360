-- Per-client SA360 logical key → GHL custom field ID mapping (config only).
ALTER TABLE "ClientGhlDestination"
ADD COLUMN "sa360CustomFieldIdMapJson" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN "customFieldStampRequired" BOOLEAN NOT NULL DEFAULT false;

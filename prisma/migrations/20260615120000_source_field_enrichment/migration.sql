-- Source field enrichment: flexible attributes, mappings, schema drift
ALTER TABLE "ClientGhlDestination" ADD COLUMN "sourceAttributeFieldMapJson" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ClientGhlDestination" ADD COLUMN "sourceEnrichmentPolicyJson" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "ClientGhlDestination" ADD COLUMN "sourceFieldAliasOverridesJson" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "CampaignRoutingRule" ADD COLUMN "sourceAttributeFieldMapJson" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "CampaignRoutingRule" ADD COLUMN "sourceFieldAliasOverridesJson" JSONB NOT NULL DEFAULT '{}';

ALTER TABLE "SourceLeadEvent" ADD COLUMN "enrichmentMetadataJson" JSONB;

CREATE TABLE "SourceRouteSchemaSnapshot" (
    "id" TEXT NOT NULL,
    "sourceProvider" TEXT NOT NULL,
    "sourceRouteKey" TEXT NOT NULL,
    "fieldKeysJson" JSONB NOT NULL,
    "schemaFingerprint" TEXT NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SourceRouteSchemaSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SourceRouteSchemaSnapshot_sourceProvider_sourceRouteKey_key" ON "SourceRouteSchemaSnapshot"("sourceProvider", "sourceRouteKey");
CREATE INDEX "SourceRouteSchemaSnapshot_sourceProvider_sourceRouteKey_idx" ON "SourceRouteSchemaSnapshot"("sourceProvider", "sourceRouteKey");

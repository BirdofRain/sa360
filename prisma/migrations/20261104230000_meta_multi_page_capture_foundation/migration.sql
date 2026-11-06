-- Additive Meta multi-Page capture foundation.
-- New empty tables + enums only. No rewrites of existing rows.
-- Does not touch ClientAccount, SourceFunnel, SourceLeadEvent, CampaignRoutingRule,
-- LeadInventoryItem, delivery, or CAPI tables.
--
-- Tokens are stored only as AES-256-GCM ciphertext. There is no plaintext token column.
-- MetaPageCaptureGrant.captureEnabled defaults to false: a stored credential does not
-- authorize Graph retrieval until an operator enables that Page.
-- MetaFormCandidate is evidence only. It has no foreign key to ClientAccount.

CREATE TYPE "MetaGraphCredentialKind" AS ENUM (
  'page_access_token',
  'system_user'
);

CREATE TYPE "MetaGraphCredentialStatus" AS ENUM (
  'active',
  'disabled',
  'expired',
  'revoked',
  'missing_permission'
);

CREATE TABLE "MetaGraphCredential" (
    "id" TEXT NOT NULL,
    "kind" "MetaGraphCredentialKind" NOT NULL,
    "label" TEXT NOT NULL,
    "tokenCiphertext" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "tokenVersion" INTEGER NOT NULL DEFAULT 1,
    "appId" TEXT,
    "expiresAt" TIMESTAMP(3),
    "scopes" JSONB NOT NULL DEFAULT '[]',
    "status" "MetaGraphCredentialStatus" NOT NULL DEFAULT 'active',
    "lastCheckedAt" TIMESTAMP(3),
    "lastDiagnostic" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaGraphCredential_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MetaGraphCredential_status_idx" ON "MetaGraphCredential"("status");

CREATE TABLE "MetaPageCaptureGrant" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "pageName" TEXT,
    "credentialId" TEXT NOT NULL,
    "captureEnabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaPageCaptureGrant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaPageCaptureGrant_pageId_key" ON "MetaPageCaptureGrant"("pageId");

CREATE INDEX "MetaPageCaptureGrant_credentialId_idx" ON "MetaPageCaptureGrant"("credentialId");

CREATE INDEX "MetaPageCaptureGrant_captureEnabled_idx" ON "MetaPageCaptureGrant"("captureEnabled");

ALTER TABLE "MetaPageCaptureGrant"
  ADD CONSTRAINT "MetaPageCaptureGrant_credentialId_fkey"
  FOREIGN KEY ("credentialId") REFERENCES "MetaGraphCredential"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "MetaFormCandidate" (
    "id" TEXT NOT NULL,
    "pageId" TEXT NOT NULL,
    "formId" TEXT NOT NULL,
    "pageName" TEXT,
    "formName" TEXT,
    "campaignId" TEXT,
    "campaignName" TEXT,
    "adsetId" TEXT,
    "adId" TEXT,
    "adAccountId" TEXT,
    "sourceLabel" TEXT NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MetaFormCandidate_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaFormCandidate_pageId_formId_sourceLabel_key"
  ON "MetaFormCandidate"("pageId", "formId", "sourceLabel");

CREATE INDEX "MetaFormCandidate_pageId_idx" ON "MetaFormCandidate"("pageId");

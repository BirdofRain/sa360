-- Phase 1 Agent Workspace — guidance resources, playbooks, assignments, telemetry, sync audit (additive only).
-- Migration name: add_phase1_agent_workspace_guidance_models

-- CreateEnum
CREATE TYPE "GuidanceResourceType" AS ENUM (
  'SCRIPT',
  'OBJECTION',
  'REFERRAL',
  'POLICY_REVIEW',
  'POLICY_DELIVERY',
  'FOLLOW_UP',
  'UNDERWRITING',
  'TRUST_BUILDER'
);

-- CreateEnum
CREATE TYPE "ObjectionPlaybookKey" AS ENUM (
  'PRICE',
  'SPOUSE',
  'THINK_ABOUT_IT',
  'NOT_INTERESTED',
  'ALREADY_COVERED',
  'CALLBACK',
  'TRUST',
  'TOO_BUSY'
);

-- CreateEnum
CREATE TYPE "ContactGuidanceEventActionType" AS ENUM (
  'VIEWED',
  'COPIED',
  'USED',
  'DISMISSED',
  'SENT_TO_GHL',
  'OUTCOME_LOGGED'
);

-- CreateEnum
CREATE TYPE "AgentWorkspaceActionStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED');

-- CreateTable
CREATE TABLE "GuidanceResource" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "nicheKey" TEXT,
    "lifecycleStage" TEXT,
    "resourceType" "GuidanceResourceType" NOT NULL,
    "title" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GuidanceResource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GuidanceResourceVersion" (
    "id" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GuidanceResourceVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectionPlaybook" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT,
    "nicheKey" TEXT,
    "objectionKey" "ObjectionPlaybookKey" NOT NULL,
    "title" TEXT NOT NULL,
    "recommendedResponse" TEXT NOT NULL,
    "followUpMessage" TEXT,
    "nextBestAction" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ObjectionPlaybook_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClientScriptAssignment" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "subaccountIdGhl" TEXT NOT NULL DEFAULT '',
    "nicheKey" TEXT,
    "guidanceResourceId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ClientScriptAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactGuidanceEvent" (
    "id" TEXT NOT NULL,
    "contactIdGhl" TEXT,
    "leadUid" TEXT,
    "clientAccountId" TEXT NOT NULL,
    "resourceId" TEXT,
    "actionType" "ContactGuidanceEventActionType" NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ContactGuidanceEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentWorkspaceAction" (
    "id" TEXT NOT NULL,
    "clientAccountId" TEXT NOT NULL,
    "subaccountIdGhl" TEXT,
    "contactIdGhl" TEXT,
    "leadUid" TEXT,
    "actionType" TEXT NOT NULL,
    "status" "AgentWorkspaceActionStatus" NOT NULL DEFAULT 'PENDING',
    "payloadJson" JSONB NOT NULL,
    "responseJson" JSONB,
    "errorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgentWorkspaceAction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "GuidanceResource_clientAccountId_idx" ON "GuidanceResource"("clientAccountId");

-- CreateIndex
CREATE INDEX "GuidanceResource_nicheKey_idx" ON "GuidanceResource"("nicheKey");

-- CreateIndex
CREATE INDEX "GuidanceResource_lifecycleStage_idx" ON "GuidanceResource"("lifecycleStage");

-- CreateIndex
CREATE INDEX "GuidanceResource_clientAccountId_nicheKey_idx" ON "GuidanceResource"("clientAccountId", "nicheKey");

-- CreateIndex
CREATE INDEX "GuidanceResource_clientAccountId_lifecycleStage_idx" ON "GuidanceResource"("clientAccountId", "lifecycleStage");

-- CreateIndex
CREATE INDEX "GuidanceResource_clientAccountId_resourceType_isActive_idx" ON "GuidanceResource"("clientAccountId", "resourceType", "isActive");

-- CreateIndex
CREATE INDEX "GuidanceResource_slug_idx" ON "GuidanceResource"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "GuidanceResourceVersion_resourceId_version_key" ON "GuidanceResourceVersion"("resourceId", "version");

-- CreateIndex
CREATE INDEX "GuidanceResourceVersion_resourceId_createdAt_idx" ON "GuidanceResourceVersion"("resourceId", "createdAt");

-- CreateIndex
CREATE INDEX "ObjectionPlaybook_clientAccountId_idx" ON "ObjectionPlaybook"("clientAccountId");

-- CreateIndex
CREATE INDEX "ObjectionPlaybook_nicheKey_idx" ON "ObjectionPlaybook"("nicheKey");

-- CreateIndex
CREATE INDEX "ObjectionPlaybook_clientAccountId_nicheKey_idx" ON "ObjectionPlaybook"("clientAccountId", "nicheKey");

-- CreateIndex
CREATE INDEX "ObjectionPlaybook_objectionKey_idx" ON "ObjectionPlaybook"("objectionKey");

-- CreateIndex
CREATE INDEX "ObjectionPlaybook_clientAccountId_objectionKey_isActive_idx" ON "ObjectionPlaybook"("clientAccountId", "objectionKey", "isActive");

-- CreateIndex
CREATE INDEX "ClientScriptAssignment_clientAccountId_idx" ON "ClientScriptAssignment"("clientAccountId");

-- CreateIndex
CREATE INDEX "ClientScriptAssignment_clientAccountId_subaccountIdGhl_idx" ON "ClientScriptAssignment"("clientAccountId", "subaccountIdGhl");

-- CreateIndex
CREATE INDEX "ClientScriptAssignment_guidanceResourceId_idx" ON "ClientScriptAssignment"("guidanceResourceId");

-- CreateIndex
CREATE INDEX "ClientScriptAssignment_nicheKey_idx" ON "ClientScriptAssignment"("nicheKey");

-- CreateIndex
CREATE INDEX "ClientScriptAssignment_clientAccountId_nicheKey_idx" ON "ClientScriptAssignment"("clientAccountId", "nicheKey");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_clientAccountId_idx" ON "ContactGuidanceEvent"("clientAccountId");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_contactIdGhl_idx" ON "ContactGuidanceEvent"("contactIdGhl");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_leadUid_idx" ON "ContactGuidanceEvent"("leadUid");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_clientAccountId_contactIdGhl_idx" ON "ContactGuidanceEvent"("clientAccountId", "contactIdGhl");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_clientAccountId_leadUid_idx" ON "ContactGuidanceEvent"("clientAccountId", "leadUid");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_resourceId_idx" ON "ContactGuidanceEvent"("resourceId");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_createdAt_idx" ON "ContactGuidanceEvent"("createdAt");

-- CreateIndex
CREATE INDEX "ContactGuidanceEvent_clientAccountId_createdAt_idx" ON "ContactGuidanceEvent"("clientAccountId", "createdAt");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_clientAccountId_idx" ON "AgentWorkspaceAction"("clientAccountId");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_contactIdGhl_idx" ON "AgentWorkspaceAction"("contactIdGhl");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_leadUid_idx" ON "AgentWorkspaceAction"("leadUid");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_clientAccountId_contactIdGhl_idx" ON "AgentWorkspaceAction"("clientAccountId", "contactIdGhl");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_clientAccountId_leadUid_idx" ON "AgentWorkspaceAction"("clientAccountId", "leadUid");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_status_idx" ON "AgentWorkspaceAction"("status");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_actionType_idx" ON "AgentWorkspaceAction"("actionType");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_clientAccountId_status_idx" ON "AgentWorkspaceAction"("clientAccountId", "status");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_clientAccountId_subaccountIdGhl_idx" ON "AgentWorkspaceAction"("clientAccountId", "subaccountIdGhl");

-- CreateIndex
CREATE INDEX "AgentWorkspaceAction_createdAt_idx" ON "AgentWorkspaceAction"("createdAt");

-- AddForeignKey
ALTER TABLE "GuidanceResourceVersion" ADD CONSTRAINT "GuidanceResourceVersion_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "GuidanceResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClientScriptAssignment" ADD CONSTRAINT "ClientScriptAssignment_guidanceResourceId_fkey" FOREIGN KEY ("guidanceResourceId") REFERENCES "GuidanceResource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactGuidanceEvent" ADD CONSTRAINT "ContactGuidanceEvent_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "GuidanceResource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

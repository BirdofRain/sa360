import type { LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import type { SourceLeadProvider, SourceLeadSystem, SourceLeadType } from "@prisma/client";

/** Shared contract for source-specific normalizers (LeadCapture.io, CSV, Meta, vendors). */
export interface SourceLeadNormalizer {
  provider: SourceLeadProvider;
  sourceSystem: SourceLeadSystem;
  canNormalize(raw: unknown): boolean;
  normalize(raw: Record<string, unknown>): LifecycleEventSchema;
  inferRoutingKeys(raw: Record<string, unknown>): SourceRoutingKeyHints;
}

export type SourceRoutingKeyHints = {
  sourceProvider?: string;
  sourceSystem?: string;
  sourceType?: string;
  sourceRouteKey?: string;
  campaignId?: string;
  utmCampaign?: string;
  funnelName?: string;
  campaignName?: string;
};

export type SourceIntakeKind = "webhook" | "csv_import" | "google_sheet_import" | "api_import";

/** Future bulk import source descriptor (scaffolding only). */
export type SourceImportSourceDescriptor = {
  kind: SourceIntakeKind;
  provider: SourceLeadProvider;
  sourceSystem: SourceLeadSystem;
  sourceType: SourceLeadType;
  importBatchId?: string;
  targetClientAccountId?: string;
  targetLocationIdGhl?: string;
  routeOverrideAllowed?: boolean;
};

export type SourceLeadRoutingResult = {
  matched: boolean;
  matchedRuleId?: string;
  destinationClientAccountId?: string;
  destinationLocationIdGhl?: string;
  reason: string;
  matchType?: string;
  routingDryRunDecisionId?: string;
};

export const SOURCE_LEAD_APPROVE_DELIVERY_CONFIRMATION =
  "APPROVE SOURCE LEAD DELIVERY" as const;

export const LEADCAPTURE_IO_MASTER_CLIENT_ACCOUNT_ID = "leadcapture_io" as const;

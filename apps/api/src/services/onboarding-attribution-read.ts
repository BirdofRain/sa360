/**
 * Read the stored onboarding actor for one request id.
 * Selects id, request id, and actor only. Does not insert, update, or call
 * Google, GoHighLevel, or routing.
 */

import type { PrismaClient } from "@prisma/client";

import { TEAM_WORKSPACE_CLIENT_ID } from "./team-workspace/team-workspace-read.js";

export const ONBOARDING_ATTRIBUTION_RECORD_TYPES = [
  "setup_audit",
  "source_campaign_request",
  "ghl_destination_configuration_request",
  "company_sheets_destination_configuration_request",
] as const;

export type OnboardingAttributionRecordType = (typeof ONBOARDING_ATTRIBUTION_RECORD_TYPES)[number];

export type OnboardingAttributionHit = {
  recordType: OnboardingAttributionRecordType;
  recordId: string;
  requestId: string;
  actor: string | null;
};

export type OnboardingAttributionResult =
  | ({ ok: true; clientAccountId: string } & OnboardingAttributionHit)
  | { ok: false; statusCode: 400 | 404 | 409; error: "invalid_request_id" | "attribution_not_found" | "attribution_ambiguous" };

const REQUEST_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOnboardingAttributionRequestId(value: string): boolean {
  return REQUEST_ID.test(value);
}

export async function readOnboardingAttribution(
  db: PrismaClient,
  clientAccountId: string,
  requestId: string
): Promise<OnboardingAttributionResult> {
  const client = clientAccountId.trim();
  const id = requestId.trim();
  if (!TEAM_WORKSPACE_CLIENT_ID.test(client) || !isOnboardingAttributionRequestId(id)) {
    return { ok: false, statusCode: 400, error: "invalid_request_id" };
  }

  const where = { clientAccountId: client, requestId: id };
  const [setup, source, ghl, sheets] = await Promise.all([
    db.clientOnboardingSetupAuditEvent.findFirst({
      where,
      select: { id: true, requestId: true, actor: true },
    }),
    db.sourceCampaignAssociationRequest.findFirst({
      where,
      select: { id: true, requestId: true, actor: true },
    }),
    db.ghlDestinationConfigurationRequest.findFirst({
      where,
      select: { id: true, requestId: true, actor: true },
    }),
    db.companySheetsDestinationConfigurationRequest.findFirst({
      where,
      select: { id: true, requestId: true, actor: true },
    }),
  ]);

  const hits: OnboardingAttributionHit[] = [];
  if (setup) {
    hits.push({
      recordType: "setup_audit",
      recordId: setup.id,
      requestId: setup.requestId,
      actor: setup.actor,
    });
  }
  if (source) {
    hits.push({
      recordType: "source_campaign_request",
      recordId: source.id,
      requestId: source.requestId,
      actor: source.actor,
    });
  }
  if (ghl) {
    hits.push({
      recordType: "ghl_destination_configuration_request",
      recordId: ghl.id,
      requestId: ghl.requestId,
      actor: ghl.actor,
    });
  }
  if (sheets) {
    hits.push({
      recordType: "company_sheets_destination_configuration_request",
      recordId: sheets.id,
      requestId: sheets.requestId,
      actor: sheets.actor,
    });
  }

  const hit = hits[0];
  if (!hit) return { ok: false, statusCode: 404, error: "attribution_not_found" };
  if (hits.length > 1) return { ok: false, statusCode: 409, error: "attribution_ambiguous" };
  return { ok: true, clientAccountId: client, ...hit };
}

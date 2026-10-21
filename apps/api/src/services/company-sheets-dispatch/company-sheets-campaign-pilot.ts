import { randomUUID } from "node:crypto";

import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import {
  COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION,
  COMPANY_SHEETS_LEAD_HEADER,
  isCompanyGoogleSheetsDispatchEnabled,
} from "../../lib/company-google-sheets-env.js";
import { extractRoutingAttributionFromPayload } from "../../lib/routing-attribution-extract.js";
import { lifecycleEventSchema, type LifecycleEventSchema } from "../../schemas/lifecycle-event.schema.js";
import { matchCampaignRoutingRule, isExactRoutingRuleMatchType, type RoutingMatchResult } from "../routing-matcher.service.js";
import {
  resolveRoutingDestinationFromConfirmedSourceAssociation,
  ROUTING_AUTHORITY_CAMPAIGN_RULE,
  ROUTING_AUTHORITY_OPERATOR_DESTINATION,
  ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
  type RoutingAuthority,
} from "../routing-source-association.service.js";
import { recordCompanySheetsCampaignIntent } from "./company-sheets-dispatch-record.js";

/** The only client this pilot may confirm. The request body cannot choose another. */
export const COMPANY_SHEETS_INTERNAL_TEST_CLIENT = "company_sheets_internal_test";
export const COMPANY_SHEETS_PILOT_ROUTE_KEY = "company_sheets_internal_pilot";
export const COMPANY_SHEETS_PILOT_MATCH_TYPE = "internal_sheets_pilot";
export const COMPANY_SHEETS_PILOT_FIRST_NAME = "Synthetic";
export const COMPANY_SHEETS_PILOT_LAST_NAME = "Sheets";
export const COMPANY_SHEETS_PILOT_EMAIL = "sheets-pilot@example.invalid";
export const COMPANY_SHEETS_PILOT_PHONE = "+15555550123";

const PILOT_KEY = /^pilot-[a-z0-9][a-z0-9-]{5,62}$/;
const PILOT_BODY_KEYS = new Set(["idempotencyKey"]);

type PilotDb = PrismaClient | Prisma.TransactionClient;

export type CompanySheetsPilotFailure = { ok: false; code: string; statusCode: number };

export type CompanySheetsPilotConfirmation =
  | {
      ok: true;
      routingAuthority: RoutingAuthority;
      matchType: string;
      matchedRuleId: string | null;
      destinationSubaccountIdGhl: string;
      reason: string;
    }
  | { ok: false; code: "pilot_routed_elsewhere" };

export type CompanySheetsPilotSuccess = {
  ok: true;
  created: boolean;
  clientAccountId: string;
  sourceLeadEventId: string;
  routingDryRunDecisionId: string | null;
  routingAuthority: string | null;
  matchType: string | null;
  intentId: string | null;
  intentStatus: string | null;
  executed: false;
  googleCalled: false;
};

export type CompanySheetsPilotDeps = {
  db?: PrismaClient;
  env?: NodeJS.ProcessEnv;
  now?: () => Date;
  /** Test-only. The HTTP route never sets this. */
  allowTestClient?: boolean;
  clientAccountId?: string;
  confirmRoute?: (
    db: PilotDb,
    clientAccountId: string,
    now: Date
  ) => Promise<CompanySheetsPilotConfirmation>;
};

class PilotRejected extends Error {
  constructor(readonly failure: CompanySheetsPilotFailure) {
    super(failure.code);
  }
}

export function parseCompanySheetsCampaignPilotBody(
  body: unknown
): { ok: true; idempotencyKey: string } | { ok: false; code: "invalid_pilot" } {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, code: "invalid_pilot" };
  const record = body as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!PILOT_BODY_KEYS.has(key)) return { ok: false, code: "invalid_pilot" };
  }
  if (typeof record.idempotencyKey !== "string" || !PILOT_KEY.test(record.idempotencyKey)) {
    return { ok: false, code: "invalid_pilot" };
  }
  return { ok: true, idempotencyKey: record.idempotencyKey };
}

export function decideCompanySheetsPilotRoute(input: {
  clientAccountId: string;
  ruleMatch: RoutingMatchResult;
  associationClientAccountId: string | null;
  associationSubaccountIdGhl: string;
  associationReason: string | null;
}): CompanySheetsPilotConfirmation {
  const exact =
    input.ruleMatch.matched &&
    input.ruleMatch.matchType != null &&
    isExactRoutingRuleMatchType(input.ruleMatch.matchType);
  if (exact) {
    if (input.ruleMatch.destinationClientAccountId !== input.clientAccountId) {
      return { ok: false, code: "pilot_routed_elsewhere" };
    }
    return {
      ok: true,
      routingAuthority: ROUTING_AUTHORITY_CAMPAIGN_RULE,
      matchType: input.ruleMatch.matchType ?? "campaign_id",
      matchedRuleId: input.ruleMatch.matchedRuleId ?? null,
      destinationSubaccountIdGhl: input.ruleMatch.destinationSubaccountIdGhl ?? "",
      reason: input.ruleMatch.reason,
    };
  }
  if (input.associationClientAccountId) {
    if (input.associationClientAccountId !== input.clientAccountId) {
      return { ok: false, code: "pilot_routed_elsewhere" };
    }
    return {
      ok: true,
      routingAuthority: ROUTING_AUTHORITY_SOURCE_ASSOCIATION,
      matchType: "confirmed_source_association",
      matchedRuleId: null,
      destinationSubaccountIdGhl: input.associationSubaccountIdGhl,
      reason: input.associationReason ?? "Matched confirmed source association for the internal test client",
    };
  }
  if (input.ruleMatch.matched) {
    if (input.ruleMatch.destinationClientAccountId !== input.clientAccountId) {
      return { ok: false, code: "pilot_routed_elsewhere" };
    }
    return {
      ok: true,
      routingAuthority: ROUTING_AUTHORITY_CAMPAIGN_RULE,
      matchType: input.ruleMatch.matchType ?? "keyword_fallback",
      matchedRuleId: input.ruleMatch.matchedRuleId ?? null,
      destinationSubaccountIdGhl: input.ruleMatch.destinationSubaccountIdGhl ?? "",
      reason: input.ruleMatch.reason,
    };
  }
  return {
    ok: true,
    routingAuthority: ROUTING_AUTHORITY_OPERATOR_DESTINATION,
    matchType: COMPANY_SHEETS_PILOT_MATCH_TYPE,
    matchedRuleId: null,
    destinationSubaccountIdGhl: "",
    reason: "Operator-confirmed synthetic company Sheets pilot for the internal test client",
  };
}

function pilotLifecycle(input: {
  clientAccountId: string;
  idempotencyKey: string;
  eventUuid: string;
  leadUid: string;
  receivedAt: Date;
}): LifecycleEventSchema {
  return lifecycleEventSchema.parse({
    schema_version: "sa360.lifecycle.v1",
    client_account_id: input.clientAccountId,
    contact: {
      lead_uid: input.leadUid,
      first_name: COMPANY_SHEETS_PILOT_FIRST_NAME,
      last_name: COMPANY_SHEETS_PILOT_LAST_NAME,
      email: COMPANY_SHEETS_PILOT_EMAIL,
      phone: COMPANY_SHEETS_PILOT_PHONE,
      phone_e164: COMPANY_SHEETS_PILOT_PHONE,
    },
    attribution: {
      source_platform: "company_sheets_internal_pilot",
    },
    state: {},
    event: {
      event_uuid: input.eventUuid,
      event_name_internal: "lead_created",
      event_name_meta: "Lead",
      event_time_unix: Math.floor(input.receivedAt.getTime() / 1000),
      send_to_meta: false,
    },
    routing: {
      source_intake: {
        provider: "company_sheets_internal_pilot",
      },
    },
  });
}

function sameHeader(actual: unknown): boolean {
  if (!Array.isArray(actual) || actual.length !== COMPANY_SHEETS_LEAD_HEADER.length) return false;
  return COMPANY_SHEETS_LEAD_HEADER.every((cell, index) => actual[index] === cell);
}

async function defaultConfirmRoute(
  db: PilotDb,
  clientAccountId: string,
  now: Date
): Promise<CompanySheetsPilotConfirmation> {
  const payload = pilotLifecycle({
    clientAccountId,
    idempotencyKey: "pilot-precheck",
    eventUuid: "pilot-precheck",
    leadUid: "pilot-precheck",
    receivedAt: now,
  });
  const attribution = extractRoutingAttributionFromPayload(payload);
  const rules = await db.campaignRoutingRule.findMany({ where: { active: true } });
  const ruleMatch = matchCampaignRoutingRule(rules, attribution, now);
  const association = await resolveRoutingDestinationFromConfirmedSourceAssociation(
    payload,
    db as PrismaClient
  );
  return decideCompanySheetsPilotRoute({
    clientAccountId,
    ruleMatch,
    associationClientAccountId: association.resolved ? association.destination.destinationClientAccountId : null,
    associationSubaccountIdGhl: association.resolved ? association.destination.destinationSubaccountIdGhl : "",
    associationReason: association.resolved
      ? `Matched confirmed source association → ${association.destination.destinationClientAccountId}`
      : null,
  });
}

function storedRoute(value: unknown): { routingAuthority: string | null; matchType: string | null; decisionId: string | null } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { routingAuthority: null, matchType: null, decisionId: null };
  }
  const record = value as Record<string, unknown>;
  return {
    routingAuthority: typeof record.routingAuthority === "string" ? record.routingAuthority : null,
    matchType: typeof record.matchType === "string" ? record.matchType : null,
    decisionId: typeof record.routingDryRunDecisionId === "string" ? record.routingDryRunDecisionId : null,
  };
}

/**
 * Admin-only synthetic campaign submission for the internal test client.
 * Refuses before any write unless dispatch, that client's campaign switch, and
 * the bound Campaign Leads tab are already armed. Does not call Google, GHL,
 * Meta, inventory, or billing, and does not enqueue a delivery job.
 */
export async function submitCompanySheetsCampaignPilot(
  input: { idempotencyKey: string },
  deps: CompanySheetsPilotDeps = {}
): Promise<CompanySheetsPilotSuccess | CompanySheetsPilotFailure> {
  const parsed = parseCompanySheetsCampaignPilotBody({ idempotencyKey: input.idempotencyKey });
  if (!parsed.ok) return { ok: false, code: parsed.code, statusCode: 400 };
  const env = deps.env ?? process.env;
  const db = deps.db ?? prisma;
  const now = deps.now?.() ?? new Date();
  const clientAccountId =
    deps.allowTestClient && deps.clientAccountId?.trim()
      ? deps.clientAccountId.trim()
      : COMPANY_SHEETS_INTERNAL_TEST_CLIENT;
  const confirm = deps.confirmRoute ?? defaultConfirmRoute;

  if (!isCompanyGoogleSheetsDispatchEnabled(env)) {
    return { ok: false, code: "pilot_not_armed", statusCode: 409 };
  }
  const armed = await destinationArmed(db, clientAccountId, now);
  if (!armed) return { ok: false, code: "pilot_not_armed", statusCode: 409 };

  try {
    return await db.$transaction(async (tx) => {
      const lockKey = `company-sheets-pilot:${clientAccountId}:${parsed.idempotencyKey}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
      const existing = await tx.sourceLeadEvent.findFirst({
        where: {
          sourceProvider: "manual_import",
          sourceSystem: "external_vendor",
          sourceType: "manual_entry",
          sourceRouteKey: COMPANY_SHEETS_PILOT_ROUTE_KEY,
          sourceLeadId: parsed.idempotencyKey,
        },
      });
      if (existing) {
        if (existing.clientAccountIdResolved !== clientAccountId || existing.status !== "routing_matched") {
          throw new PilotRejected({ ok: false, code: "pilot_conflict", statusCode: 409 });
        }
        const route = storedRoute(existing.routingResultJson);
        const intent = await tx.companySheetsDispatchIntent.findUnique({
          where: { idempotencyKey: `campaign:${clientAccountId}:${existing.id}` },
        });
        return {
          ok: true as const,
          created: false,
          clientAccountId,
          sourceLeadEventId: existing.id,
          routingDryRunDecisionId: existing.routingDryRunDecisionId ?? route.decisionId,
          routingAuthority: route.routingAuthority,
          matchType: route.matchType,
          intentId: intent?.id ?? null,
          intentStatus: intent?.status ?? null,
          executed: false as const,
          googleCalled: false as const,
        };
      }

      const stillArmed = await destinationArmed(tx, clientAccountId, now);
      if (!stillArmed) throw new PilotRejected({ ok: false, code: "pilot_not_armed", statusCode: 409 });
      const confirmation = await confirm(tx, clientAccountId, now);
      if (!confirmation.ok) throw new PilotRejected({ ok: false, code: confirmation.code, statusCode: 409 });

      let destinationSubaccountIdGhl = confirmation.destinationSubaccountIdGhl;
      if (!destinationSubaccountIdGhl) {
        const ghl = await tx.clientGhlDestination.findUnique({
          where: { clientAccountId },
          select: { destinationSubaccountIdGhl: true },
        });
        destinationSubaccountIdGhl = ghl?.destinationSubaccountIdGhl?.trim() ?? "";
      }

      const eventUuid = randomUUID();
      const leadUid = `sheets-pilot:${parsed.idempotencyKey}:${eventUuid}`;
      const normalized = pilotLifecycle({
        clientAccountId,
        idempotencyKey: parsed.idempotencyKey,
        eventUuid,
        leadUid,
        receivedAt: now,
      });
      const decision = await tx.routingDryRunDecision.create({
        data: {
          masterClientAccountId: clientAccountId,
          sourceEventUuid: eventUuid,
          sourceLeadUid: leadUid,
          matched: true,
          confidence: "high",
          matchedRuleId: confirmation.matchedRuleId,
          destinationClientAccountId: clientAccountId,
          destinationSubaccountIdGhl,
          matchReason: confirmation.reason,
          deliveryMode: "dry_run",
          routingEventNameInternal: "lead_matched",
          attributionSnapshot: {
            matchType: confirmation.matchType,
            routingAuthority: confirmation.routingAuthority,
            syntheticPilot: true,
            sourceRouteKey: COMPANY_SHEETS_PILOT_ROUTE_KEY,
            campaignId: null,
            formId: null,
            utmCampaign: null,
            sendToMeta: false,
          },
        },
      });
      const routing = {
        matched: true,
        matchedRuleId: confirmation.matchedRuleId,
        destinationClientAccountId: clientAccountId,
        destinationLocationIdGhl: destinationSubaccountIdGhl,
        reason: confirmation.reason,
        matchType: confirmation.matchType,
        routingDryRunDecisionId: decision.id,
        routingAuthority: confirmation.routingAuthority,
        syntheticPilot: true,
      };
      const lead = await tx.sourceLeadEvent.create({
        data: {
          sourceProvider: "manual_import",
          sourceSystem: "external_vendor",
          sourceType: "manual_entry",
          sourceRouteKey: COMPANY_SHEETS_PILOT_ROUTE_KEY,
          sourceLeadId: parsed.idempotencyKey,
          sourceLeadUid: leadUid,
          status: "routing_matched",
          clientAccountIdResolved: clientAccountId,
          destinationLocationIdResolved: destinationSubaccountIdGhl || null,
          routingRuleIdResolved: confirmation.matchedRuleId,
          rawPayloadJson: {
            synthetic: true,
            pilot: COMPANY_SHEETS_PILOT_ROUTE_KEY,
            idempotencyKey: parsed.idempotencyKey,
          },
          normalizedPayloadJson: normalized as Prisma.InputJsonValue,
          routingResultJson: routing,
          enrichmentMetadataJson: {
            intake: COMPANY_SHEETS_PILOT_ROUTE_KEY,
            externalDelivery: "not_requested",
            sendToMeta: false,
            inventoryTracked: false,
          },
          routingDryRunDecisionId: decision.id,
          receivedAt: now,
          normalizedAt: now,
          routedAt: now,
        },
      });
      await recordCompanySheetsCampaignIntent(
        {
          sourceLeadEventId: lead.id,
          status: "routing_matched",
          clientAccountId,
          resolvedAt: now,
        },
        tx,
        env
      );
      const intent = await tx.companySheetsDispatchIntent.findUnique({
        where: { idempotencyKey: `campaign:${clientAccountId}:${lead.id}` },
      });
      if (!intent || intent.status !== "pending") {
        throw new PilotRejected({ ok: false, code: "pilot_not_armed", statusCode: 409 });
      }
      return {
        ok: true as const,
        created: true,
        clientAccountId,
        sourceLeadEventId: lead.id,
        routingDryRunDecisionId: decision.id,
        routingAuthority: confirmation.routingAuthority,
        matchType: confirmation.matchType,
        intentId: intent.id,
        intentStatus: intent.status,
        executed: false as const,
        googleCalled: false as const,
      };
    });
  } catch (err) {
    if (err instanceof PilotRejected) return err.failure;
    throw err;
  }
}

async function destinationArmed(db: PilotDb, clientAccountId: string, now: Date): Promise<boolean> {
  const destination = await db.companySheetsDestination.findUnique({ where: { clientAccountId } });
  if (!destination?.campaignDispatchEnabled || !destination.campaignDispatchNotBefore) return false;
  if (now < destination.campaignDispatchNotBefore) return false;
  const tab = await db.companySheetsTabContract.findUnique({
    where: { destinationId_role: { destinationId: destination.id, role: "campaign" } },
  });
  return Boolean(
    tab &&
      tab.setupState === "bound" &&
      tab.worksheetId != null &&
      tab.schemaVersion === COMPANY_SHEETS_CAMPAIGN_SCHEMA_VERSION &&
      sameHeader(tab.headerContract)
  );
}

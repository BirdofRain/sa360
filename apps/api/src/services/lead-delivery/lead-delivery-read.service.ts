import type {
  GhlDeliveryAdapterRun,
  GhlLiveDeliveryRun,
  LeadDeliveryPlan,
  PrismaClient,
  RoutingDryRunDecision,
  SourceLeadEvent,
} from "@prisma/client";
import { prisma } from "../../lib/db.js";
import { findClientAccountsByIds } from "../../repositories/client-account.repository.js";
import { findDeliveryPlanSummariesByDecisionIds } from "../../repositories/lead-delivery-plan.repository.js";
import { findLatestGhlLiveDeliveryRunForPlan } from "../../repositories/ghl-live-delivery-run.repository.js";
import {
  findSourceLeadEventById,
  listSourceLeadEvents,
  type SourceLeadEventListFilters,
} from "../../repositories/source-lead-event.repository.js";
import { getLeadTimeline } from "../lead-timeline.service.js";
import type { LeadTimelineResponse } from "../lead-timeline.types.js";

export type LeadDeliveryJoinContext = {
  sourceLead: SourceLeadEvent;
  decision: RoutingDryRunDecision | null;
  plan: Pick<
    LeadDeliveryPlan,
    "id" | "routingDryRunDecisionId" | "status" | "deliveryMode" | "generatedAt"
  > | null;
  adapterRun: Pick<GhlDeliveryAdapterRun, "id" | "status" | "mode" | "summary"> | null;
  liveRun: Pick<GhlLiveDeliveryRun, "id" | "status" | "completedAt" | "summary"> | null;
  clientDisplayName: string | null;
  timeline: LeadTimelineResponse | null;
};

export type LeadDeliveryReadServiceDeps = {
  db?: PrismaClient;
  listSourceLeadEventsImpl?: typeof listSourceLeadEvents;
  findSourceLeadEventByIdImpl?: typeof findSourceLeadEventById;
  getLeadTimelineImpl?: typeof getLeadTimeline;
};

function asRecord(v: unknown): Record<string, unknown> | null {
  if (v !== null && typeof v === "object" && !Array.isArray(v)) {
    return v as Record<string, unknown>;
  }
  return null;
}

function parseContactFromNormalized(normalizedPayloadJson: unknown): {
  leadName: string | null;
  phoneE164: string | null;
  email: string | null;
} {
  const root = asRecord(normalizedPayloadJson);
  const contact = asRecord(root?.contact);
  const first = typeof contact?.first_name === "string" ? contact.first_name.trim() : "";
  const last = typeof contact?.last_name === "string" ? contact.last_name.trim() : "";
  const leadName = [first, last].filter(Boolean).join(" ").trim() || null;
  const phoneE164 =
    typeof contact?.phone_e164 === "string"
      ? contact.phone_e164.trim() || null
      : typeof contact?.phone === "string"
        ? contact.phone.trim() || null
        : null;
  const email = typeof contact?.email === "string" ? contact.email.trim() || null : null;
  return { leadName, phoneE164, email };
}

function parseAttributionIds(enrichmentMetadataJson: unknown): { adId: string | null; adName: string | null } {
  const enrichment = asRecord(enrichmentMetadataJson);
  const attrs = asRecord(enrichment?.sourceAttributes);
  const adId =
    typeof attrs?.ad_id === "string"
      ? attrs.ad_id
      : typeof attrs?.adId === "string"
        ? attrs.adId
        : null;
  const adName =
    typeof attrs?.ad_name === "string"
      ? attrs.ad_name
      : typeof attrs?.adName === "string"
        ? attrs.adName
        : null;
  return { adId, adName };
}

function contactIdFromDeliveryResult(deliveryResultJson: unknown): string | null {
  const root = asRecord(deliveryResultJson);
  if (!root) return null;
  const direct = root.contactIdGhl ?? root.contact_id_ghl;
  if (typeof direct === "string" && direct.trim()) return direct.trim();
  const contact = asRecord(root.contact);
  const nested = contact?.contact_id_ghl ?? contact?.id;
  if (typeof nested === "string" && nested.trim()) return nested.trim();
  return null;
}

function deliveryResultStatus(deliveryResultJson: unknown): string | null {
  const root = asRecord(deliveryResultJson);
  const status = root?.status ?? root?.deliveryStatus;
  return typeof status === "string" ? status : null;
}

function deliveryResultContactStatus(deliveryResultJson: unknown): string | null {
  const root = asRecord(deliveryResultJson);
  const status = root?.contactStatus ?? root?.contact_status;
  return typeof status === "string" ? status : null;
}

async function loadDecisionsByIds(
  ids: string[],
  db: PrismaClient
): Promise<Map<string, RoutingDryRunDecision>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (!unique.length) return new Map();
  const rows = await db.routingDryRunDecision.findMany({ where: { id: { in: unique } } });
  return new Map(rows.map((r) => [r.id, r]));
}

async function loadLatestAdapterRunForPlan(
  planId: string,
  db: PrismaClient
): Promise<Pick<GhlDeliveryAdapterRun, "id" | "status" | "mode" | "summary"> | null> {
  return db.ghlDeliveryAdapterRun.findFirst({
    where: { leadDeliveryPlanId: planId },
    orderBy: { startedAt: "desc" },
    select: { id: true, status: true, mode: true, summary: true },
  });
}

async function joinSourceLeads(
  rows: SourceLeadEvent[],
  opts: { includeTimeline: boolean },
  deps: LeadDeliveryReadServiceDeps
): Promise<LeadDeliveryJoinContext[]> {
  const db = deps.db ?? prisma;
  const decisionIds = rows.map((r) => r.routingDryRunDecisionId).filter(Boolean) as string[];
  const [decisionMap, planSummaries, clientAccounts] = await Promise.all([
    loadDecisionsByIds(decisionIds, db),
    findDeliveryPlanSummariesByDecisionIds(decisionIds, db),
    findClientAccountsByIds(
      [...new Set(rows.map((r) => r.clientAccountIdResolved).filter(Boolean) as string[])],
      db
    ),
  ]);

  const planByDecision = new Map(planSummaries.map((p) => [p.routingDryRunDecisionId, p]));
  const clientNameById = new Map(clientAccounts.map((c) => [c.clientAccountId, c.clientDisplayName]));

  return Promise.all(
    rows.map(async (sourceLead) => {
      const decision = sourceLead.routingDryRunDecisionId
        ? decisionMap.get(sourceLead.routingDryRunDecisionId) ?? null
        : null;
      const plan = sourceLead.routingDryRunDecisionId
        ? planByDecision.get(sourceLead.routingDryRunDecisionId) ?? null
        : null;

      let adapterRun: LeadDeliveryJoinContext["adapterRun"] = null;
      let liveRun: LeadDeliveryJoinContext["liveRun"] = null;
      if (plan?.id && opts.includeTimeline) {
        [adapterRun, liveRun] = await Promise.all([
          loadLatestAdapterRunForPlan(plan.id, db),
          findLatestGhlLiveDeliveryRunForPlan(plan.id, db).then((r) =>
            r
              ? {
                  id: r.id,
                  status: r.status,
                  completedAt: r.completedAt,
                  summary: r.summary,
                }
              : null
          ),
        ]);
      }

      const contact = parseContactFromNormalized(sourceLead.normalizedPayloadJson);
      const clientAccountId = sourceLead.clientAccountIdResolved ?? decision?.destinationClientAccountId ?? null;
      let timeline: LeadTimelineResponse | null = null;
      if (opts.includeTimeline && clientAccountId) {
        const getTimeline = deps.getLeadTimelineImpl ?? getLeadTimeline;
        timeline = await getTimeline({
          clientAccountId,
          subaccountIdGhl: sourceLead.destinationLocationIdResolved ?? decision?.destinationSubaccountIdGhl ?? undefined,
          leadUid: sourceLead.sourceLeadUid ?? undefined,
          phoneE164: contact.phoneE164 ?? undefined,
          email: contact.email ?? undefined,
          limit: 100,
        });
      }

      return {
        sourceLead,
        decision,
        plan,
        adapterRun,
        liveRun,
        clientDisplayName: clientAccountId ? clientNameById.get(clientAccountId) ?? null : null,
        timeline,
      };
    })
  );
}

export async function listLeadDeliveryReadModel(
  filters: SourceLeadEventListFilters,
  deps: LeadDeliveryReadServiceDeps = {}
): Promise<{ items: LeadDeliveryJoinContext[]; nextCursor: string | null }> {
  const list = deps.listSourceLeadEventsImpl ?? listSourceLeadEvents;
  const { items, nextCursor } = await list(filters, deps.db ?? prisma);
  const joined = await joinSourceLeads(items, { includeTimeline: false }, deps);
  return { items: joined, nextCursor };
}

export async function getLeadDeliveryReadModelById(
  id: string,
  deps: LeadDeliveryReadServiceDeps = {}
): Promise<LeadDeliveryJoinContext | null> {
  const findById = deps.findSourceLeadEventByIdImpl ?? findSourceLeadEventById;
  const sourceLead = await findById(id.trim(), deps.db ?? prisma);
  if (!sourceLead) return null;
  const [joined] = await joinSourceLeads([sourceLead], { includeTimeline: true }, deps);
  return joined ?? null;
}

export {
  parseContactFromNormalized,
  parseAttributionIds,
  contactIdFromDeliveryResult,
  deliveryResultStatus,
  deliveryResultContactStatus,
};

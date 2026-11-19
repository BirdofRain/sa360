/**
 * Loads stored client, source, routing, and destination rows for the
 * read-only campaign inventory. It does not confirm a source, write a
 * routing rule, or call GoHighLevel, Google, or Meta.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { listCampaignRoutingRules } from "../../repositories/campaign-routing-rule.repository.js";
import { listSourceFunnelsForClient } from "../../repositories/source-funnel.repository.js";
import { parseSavedSetupSourceIdentity } from "../team-workspace/source-campaign-review-read.js";
import {
  buildClientCampaignInventory,
  exactIdentifierForRule,
  type ClientCampaignInventory,
  type InventoryRule,
  type InventorySource,
  type InventorySourceEvent,
} from "./client-campaign-inventory.present.js";

const IDENTIFIER_LOOKUP_LIMIT = 40;

type ReadDb = PrismaClient;

export type ClientCampaignInventoryReadResult =
  | { ok: true; inventory: ClientCampaignInventory }
  | { ok: false; statusCode: 404; error: "Client not found" };

function text(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && text(item).length > 0).map((item) => text(item));
}

function iso(value: Date | null | undefined): string | null {
  return value ? value.toISOString() : null;
}

function associationStatus(status: string): InventorySource["associationStatus"] {
  if (status === "confirmed" || status === "suggested" || status === "unassociated") return status;
  return "unassociated";
}

const eventSelect = {
  id: true,
  receivedAt: true,
  status: true,
  sourceCampaignId: true,
  sourceRouteKey: true,
  routingRuleIdResolved: true,
  clientAccountIdResolved: true,
} as const;

function presentEvent(event: {
  id: string;
  receivedAt: Date;
  status: string;
  sourceCampaignId: string | null;
  sourceRouteKey: string | null;
  routingRuleIdResolved: string | null;
  clientAccountIdResolved: string | null;
}): InventorySourceEvent {
  return {
    id: event.id,
    receivedAt: event.receivedAt.toISOString(),
    status: event.status,
    sourceCampaignId: event.sourceCampaignId,
    sourceRouteKey: event.sourceRouteKey,
    routingRuleIdResolved: event.routingRuleIdResolved,
    clientAccountIdResolved: event.clientAccountIdResolved,
  };
}

export async function readClientCampaignInventory(
  clientAccountId: string,
  db: ReadDb = prisma
): Promise<ClientCampaignInventoryReadResult> {
  const id = text(clientAccountId);
  if (!id) return { ok: false, statusCode: 404, error: "Client not found" };

  const client = await db.clientAccount.findUnique({
    where: { clientAccountId: id },
    select: {
      clientAccountId: true,
      primaryNicheKeys: true,
      primaryProductTypes: true,
      onboardingSetup: { select: { revision: true, status: true, setupDataJson: true } },
      ghlDestination: {
        select: {
          destinationSubaccountIdGhl: true,
          locationName: true,
          destinationWorkflowIdGhl: true,
          deliveryEnabled: true,
          deliveryMode: true,
          workflowTriggerMode: true,
        },
      },
      companySheetsDestination: {
        select: {
          spreadsheetId: true,
          spreadsheetTitle: true,
          spreadsheetUrl: true,
          worksheetId: true,
          worksheetTitle: true,
          enabled: true,
          campaignDispatchEnabled: true,
          deliveryExecution: true,
          accessStatus: true,
          writeReadiness: true,
          tabContracts: {
            select: { role: true, setupState: true, worksheetId: true, worksheetTitle: true },
          },
        },
      },
    },
  });
  if (!client) return { ok: false, statusCode: 404, error: "Client not found" };

  const [funnels, rules, associationRequest, columnMaps] = await Promise.all([
    listSourceFunnelsForClient(id, db),
    listCampaignRoutingRules({ clientAccountId: id }, db),
    db.sourceCampaignAssociationRequest.findFirst({
      where: { clientAccountId: id, status: "requested" },
      orderBy: { revision: "desc" },
      select: {
        id: true,
        revision: true,
        status: true,
        providerFunnelId: true,
        parentUrlKey: true,
        providerCampaignId: true,
      },
    }),
    db.clientSheetColumnMap.findMany({
      where: { clientAccountId: id },
      select: {
        spreadsheetId: true,
        worksheetId: true,
        mapVersion: true,
        status: true,
        publishedAt: true,
        retiredAt: true,
      },
    }),
  ]);

  const sources: InventorySource[] = funnels.map((funnel) => ({
    id: funnel.id,
    provider: funnel.provider,
    providerFunnelId: funnel.providerFunnelId,
    parentUrlKey: funnel.parentUrlKey,
    pageSlug: funnel.pageSlug,
    observedFunnelName: funnel.observedFunnelName,
    nicheKey: funnel.nicheKey,
    associationStatus: associationStatus(funnel.associationStatus),
    originClientAccountId: funnel.originClientAccountId,
    suggestedClientAccountId: funnel.suggestedClientAccountId,
    leadTypeKey: funnel.leadTypeKey,
    lastSeenAt: iso(funnel.lastSeenAt),
  }));

  const inventoryRules: InventoryRule[] = rules.map((rule) => ({
    id: rule.id,
    clientAccountId: rule.clientAccountId,
    matchType: rule.matchType,
    campaignId: rule.campaignId,
    campaignName: rule.campaignName,
    adsetId: rule.adsetId,
    adId: rule.adId,
    formId: rule.formId,
    utmCampaign: rule.utmCampaign,
    keywordPattern: rule.keywordPattern,
    nicheKey: rule.nicheKey,
    productType: rule.productType,
    active: rule.active,
    priority: rule.priority,
    deliveryEnabled: rule.deliveryEnabled,
    shadowDeliveryEnabled: rule.shadowDeliveryEnabled,
    deliveryMode: rule.deliveryMode,
    destinationWorkflowIdGhl: rule.destinationWorkflowIdGhl,
    destinationSubaccountIdGhl: rule.destinationSubaccountIdGhl,
  }));

  const campaignIds = new Set<string>();
  const formIds = new Set<string>();
  const adsetIds = new Set<string>();
  const adIds = new Set<string>();
  const eventValues = new Set<string>();
  for (const rule of inventoryRules) {
    const identifier = exactIdentifierForRule(rule);
    if (!identifier) continue;
    eventValues.add(identifier.value);
    if (identifier.kind === "campaign_id") campaignIds.add(identifier.value);
    if (identifier.kind === "form_id") formIds.add(identifier.value);
    if (identifier.kind === "adset_id") adsetIds.add(identifier.value);
    if (identifier.kind === "ad_id") adIds.add(identifier.value);
  }
  for (const source of sources) {
    const funnelId = text(source.providerFunnelId);
    const parentUrl = text(source.parentUrlKey);
    if (funnelId) {
      eventValues.add(funnelId);
      campaignIds.add(funnelId);
      formIds.add(funnelId);
    }
    if (parentUrl) {
      eventValues.add(parentUrl);
      campaignIds.add(parentUrl);
    }
  }

  const otherWhere: Prisma.CampaignRoutingRuleWhereInput[] = [];
  if (campaignIds.size > 0) otherWhere.push({ matchType: "campaign_id", campaignId: { in: [...campaignIds] } });
  if (formIds.size > 0) otherWhere.push({ matchType: "form_id_utm_campaign", formId: { in: [...formIds] } });
  if (adsetIds.size > 0) otherWhere.push({ matchType: "adset_id", adsetId: { in: [...adsetIds] } });
  if (adIds.size > 0) otherWhere.push({ matchType: "ad_id", adId: { in: [...adIds] } });

  const lookupValues = [...eventValues].sort();
  const lookupRuleIds = inventoryRules.map((rule) => rule.id).sort();
  const identifierLookupCapped =
    lookupValues.length > IDENTIFIER_LOOKUP_LIMIT || lookupRuleIds.length > IDENTIFIER_LOOKUP_LIMIT;
  const cappedValues = lookupValues.slice(0, IDENTIFIER_LOOKUP_LIMIT);
  const cappedRuleIds = lookupRuleIds.slice(0, IDENTIFIER_LOOKUP_LIMIT);

  const [otherClientRules, clientEvents, foreignSourceEvents] = await Promise.all([
    otherWhere.length === 0
      ? Promise.resolve([])
      : db.campaignRoutingRule.findMany({
          where: { NOT: { clientAccountId: id }, OR: otherWhere },
          select: {
            id: true,
            clientAccountId: true,
            matchType: true,
            campaignId: true,
            adsetId: true,
            adId: true,
            formId: true,
          },
        }),
    loadClientEvents(db, id, cappedValues, cappedRuleIds),
    cappedValues.length === 0
      ? Promise.resolve([])
      : db.sourceLeadEvent.findMany({
          where: {
            sourceCampaignId: { in: cappedValues },
            AND: [{ clientAccountIdResolved: { not: null } }, { NOT: { clientAccountIdResolved: id } }],
          },
          orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
          take: 30,
          select: eventSelect,
        }),
  ]);

  const setupRow = client.onboardingSetup;
  const parsedSetup = setupRow ? parseSavedSetupSourceIdentity(setupRow.setupDataJson) : null;
  const setup = !setupRow
    ? null
    : parsedSetup?.readable
      ? {
          readable: true as const,
          revision: setupRow.revision,
          status: setupRow.status,
          providerFunnelId: parsedSetup.identity.providerFunnelId,
          parentUrlKey: parsedSetup.identity.parentUrlKey,
          providerCampaignId: parsedSetup.identity.providerCampaignId,
        }
      : { readable: false as const, revision: setupRow.revision, status: setupRow.status };

  const ghl = client.ghlDestination;
  const sheets = client.companySheetsDestination;

  return {
    ok: true,
    inventory: buildClientCampaignInventory({
      clientAccountId: client.clientAccountId,
      primaryNicheKeys: stringList(client.primaryNicheKeys),
      primaryProductTypes: stringList(client.primaryProductTypes),
      sources,
      rules: inventoryRules,
      otherClientRules,
      associationRequest: associationRequest
        ? {
            id: associationRequest.id,
            revision: associationRequest.revision,
            status: associationRequest.status,
            providerFunnelId: associationRequest.providerFunnelId,
            parentUrlKey: associationRequest.parentUrlKey,
            providerCampaignId: associationRequest.providerCampaignId,
          }
        : null,
      setup,
      ghl: ghl
        ? {
            locationId: ghl.destinationSubaccountIdGhl,
            locationName: ghl.locationName,
            defaultWorkflowId: ghl.destinationWorkflowIdGhl,
            deliveryEnabled: ghl.deliveryEnabled,
            deliveryMode: ghl.deliveryMode,
            workflowTriggerMode: ghl.workflowTriggerMode,
          }
        : null,
      sheets: sheets
        ? {
            spreadsheetId: sheets.spreadsheetId,
            spreadsheetTitle: sheets.spreadsheetTitle,
            spreadsheetUrl: sheets.spreadsheetUrl,
            worksheetId: sheets.worksheetId,
            worksheetTitle: sheets.worksheetTitle,
            enabled: sheets.enabled,
            campaignDispatchEnabled: sheets.campaignDispatchEnabled,
            deliveryExecution: sheets.deliveryExecution,
            accessStatus: sheets.accessStatus,
            writeReadiness: sheets.writeReadiness,
            tabs: sheets.tabContracts,
            columnMaps: columnMaps.map((map) => ({
              spreadsheetId: map.spreadsheetId,
              worksheetId: map.worksheetId,
              mapVersion: map.mapVersion,
              status: map.status,
              publishedAt: iso(map.publishedAt),
              retiredAt: iso(map.retiredAt),
            })),
          }
        : null,
      sourceEvents: clientEvents.events,
      foreignSourceEvents: foreignSourceEvents.map(presentEvent),
      sourceEventLookupCapped: identifierLookupCapped || clientEvents.truncated,
    }),
  };
}

async function loadClientEvents(
  db: ReadDb,
  clientAccountId: string,
  values: string[],
  ruleIds: string[]
): Promise<{ events: InventorySourceEvent[]; truncated: boolean }> {
  if (values.length === 0 && ruleIds.length === 0) return { events: [], truncated: false };
  const or: Prisma.SourceLeadEventWhereInput[] = [];
  if (values.length > 0) {
    or.push({ sourceCampaignId: { in: values } });
    or.push({ sourceRouteKey: { in: values } });
  }
  if (ruleIds.length > 0) or.push({ routingRuleIdResolved: { in: ruleIds } });
  const rows = await db.sourceLeadEvent.findMany({
    where: { clientAccountIdResolved: clientAccountId, OR: or },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    take: 101,
    select: eventSelect,
  });
  const truncated = rows.length > 100;
  return { events: rows.slice(0, 100).map(presentEvent), truncated };
}

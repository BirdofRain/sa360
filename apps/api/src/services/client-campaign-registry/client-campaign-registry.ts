/**
 * Request-only campaign registry for one ClientAccount.
 *
 * A saved campaign is configuration. It is not a routing rule, not an inventory
 * key, and not a source confirmation. Creating or editing a campaign does not
 * confirm a source, create a routing rule, enroll a contact, or arm delivery.
 *
 * active, paused, and retired exist on the status enum for a later phase.
 * This service does not write them, and nothing operational reads them.
 *
 * The command row is the idempotency and audit record. The same request id and
 * payload returns that result. A different payload for that id conflicts.
 * A stale revision is not stored. A disputed exact identity is not stored as
 * a second binding; the command records REVIEW_REQUIRED and the campaign stays
 * as it was.
 */

import { createHash } from "node:crypto";

import { Prisma, type PrismaClient } from "@prisma/client";

import { isClientCampaignRegistryEnabled } from "../../lib/client-campaign-registry-env.js";
import { acceptedOnboardingActor } from "../../lib/onboarding-staff-actor.js";
import {
  duplicateIdentityInSet,
  funnelIdentifierConsistent,
  identityKey,
  isCampaignNicheKey,
  isCampaignProductType,
  isLooseRoutingMatch,
  prepareBinding,
  publicExactOverlap,
  type BindingDraft,
  type IdentifierKind,
  type IdentityDraft,
  type PreparedBinding,
} from "./identity.js";

const TRANSACTION = { timeout: 15_000 } as const;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REQUEST_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const WRITABLE_STATUS = new Set(["draft", "review", "ready"]);
const TRIGGER_MODES = new Set(["none", "direct_api", "tag_trigger"]);

const BOUNDARY = {
  routingRuleApplied: false as const,
  sourceConfirmed: false as const,
  deliveryArmed: false as const,
  externalCall: false as const,
  inventoryKeyUsed: false as const,
  operationalReady: false as const,
  originConfirmed: false as const,
  changedClientDefaultWorkflow: false as const,
  tabContractChanged: false as const,
};

export type RegistryConflict = {
  code: "exact_identifier_overlap" | "routing_authority_overlap" | "source_ownership_overlap" | "source_not_confirmed";
  scope: "same_client" | "other_client" | "unconfirmed";
  identifierKind: IdentifierKind;
  bindingKey: string;
  campaignId?: string;
};

export type RegistryCommandResult = typeof BOUNDARY & {
  ok: boolean;
  statusCode: 200 | 400 | 403 | 404 | 409;
  replayed: boolean;
  error?: string;
  outcome?: "REVIEW_REQUIRED";
  requestId?: string;
  clientAccountId?: string;
  campaignId?: string;
  revision?: number;
  campaign?: CampaignView;
  bindings?: BindingView[];
  destination?: DestinationView | null;
  conflicts?: RegistryConflict[];
};

export type CampaignView = {
  id: string;
  clientAccountId: string;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
  revision: number;
  configurationStatusEffect: "none";
  operationalReady: false;
  inventoryKeyUsed: false;
  createdAt: string;
  updatedAt: string;
};

export type BindingView = {
  id: string;
  bindingKey: string;
  status: string;
  revision: number;
  sourceFunnelId: string | null;
  campaignRoutingRuleId: string | null;
  identities: Array<{ provider: string; kind: string; normalizedValue: string }>;
  recordedEvidence: { note: string | null; observedLabel: string | null; usedAsJoinKey: false };
  originConfirmed: false;
};

export type DestinationView = {
  id: string;
  revision: number;
  ghlLocationId: string | null;
  workflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  workflowLiveVerified: false;
  spreadsheetId: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
  mapPublished: false;
  readinessWarnings: string[];
  operationalReady: false;
  changedClientDefaultWorkflow: false;
  tabContractChanged: false;
};

export type CampaignListResult =
  | (typeof BOUNDARY & {
      ok: true;
      statusCode: 200;
      clientAccountId: string;
      campaigns: CampaignSummary[];
    })
  | RegistryCommandResult;

export type CampaignSummary = CampaignView & {
  bindingCount: number;
  destinationSaved: boolean;
};

export type CampaignReadResult =
  | (typeof BOUNDARY & {
      ok: true;
      statusCode: 200;
      campaign: CampaignView;
      bindings: BindingView[];
      destination: DestinationView | null;
    })
  | RegistryCommandResult;

export type CreateCampaignCommand = {
  intent: "create";
  clientAccountId: string;
  requestId: string;
  expectedRevision: number;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
};

export type UpdateCampaignCommand = {
  intent: "update";
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
};

export type SaveBindingsCommand = {
  intent: "save_bindings";
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  bindings: BindingDraft[];
};

export type SaveDestinationCommand = {
  intent: "save_destination";
  clientAccountId: string;
  campaignId: string;
  requestId: string;
  expectedRevision: number;
  workflowIdGhl: string | null;
  workflowTriggerMode: string | null;
  ghlLocationId: string | null;
  spreadsheetId: string | null;
  worksheetId: number | null;
  worksheetTitle: string | null;
};

export type RegistryCommand =
  | CreateCampaignCommand
  | UpdateCampaignCommand
  | SaveBindingsCommand
  | SaveDestinationCommand;

type StoredSnapshot = {
  version: 1;
  statusCode: 200 | 400 | 403 | 404 | 409;
  body: RegistryCommandResult;
};

export async function listClientCampaigns(
  db: PrismaClient,
  clientAccountId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<CampaignListResult> {
  if (!isClientCampaignRegistryEnabled(env)) return failure(404, "feature_disabled");
  const id = clientAccountId.trim();
  if (!id) return failure(404, "client_not_found");
  const client = await db.clientAccount.findUnique({ where: { clientAccountId: id }, select: { clientAccountId: true } });
  if (!client) return failure(404, "client_not_found");
  const rows = await db.clientCampaign.findMany({
    where: { clientAccountId: id },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    include: {
      bindings: { where: { status: { not: "superseded" } }, select: { id: true } },
      destination: { select: { id: true } },
    },
  });
  return {
    ...BOUNDARY,
    ok: true,
    statusCode: 200,
    clientAccountId: id,
    campaigns: rows.map((row) => ({
      ...campaignView(row),
      bindingCount: row.bindings.length,
      destinationSaved: row.destination !== null,
    })),
  };
}

export async function readClientCampaign(
  db: PrismaClient,
  clientAccountId: string,
  campaignId: string,
  env: NodeJS.ProcessEnv = process.env
): Promise<CampaignReadResult> {
  if (!isClientCampaignRegistryEnabled(env)) return failure(404, "feature_disabled");
  const id = clientAccountId.trim();
  if (!id) return failure(404, "client_not_found");
  const campaign = await db.clientCampaign.findFirst({
    where: { id: campaignId, clientAccountId: id },
    include: campaignGraph,
  });
  if (!campaign) return failure(404, "campaign_not_found");
  return {
    ...BOUNDARY,
    ok: true,
    statusCode: 200,
    ...graphView(campaign),
  };
}

export async function createClientCampaign(
  db: PrismaClient,
  command: CreateCampaignCommand,
  env: NodeJS.ProcessEnv = process.env,
  actor?: string
): Promise<RegistryCommandResult> {
  return mutate(db, command, env, actor);
}

export async function updateClientCampaign(
  db: PrismaClient,
  command: UpdateCampaignCommand,
  env: NodeJS.ProcessEnv = process.env,
  actor?: string
): Promise<RegistryCommandResult> {
  return mutate(db, command, env, actor);
}

export async function saveClientCampaignBindings(
  db: PrismaClient,
  command: SaveBindingsCommand,
  env: NodeJS.ProcessEnv = process.env,
  actor?: string
): Promise<RegistryCommandResult> {
  return mutate(db, command, env, actor);
}

export async function saveClientCampaignDestination(
  db: PrismaClient,
  command: SaveDestinationCommand,
  env: NodeJS.ProcessEnv = process.env,
  actor?: string
): Promise<RegistryCommandResult> {
  return mutate(db, command, env, actor);
}

async function mutate(
  db: PrismaClient,
  command: RegistryCommand,
  env: NodeJS.ProcessEnv,
  actor: string | undefined
): Promise<RegistryCommandResult> {
  if (!isClientCampaignRegistryEnabled(env)) return failure(404, "feature_disabled");
  const recordedActor = acceptedOnboardingActor(actor);
  if (!recordedActor) return failure(403, "actor_rejected");
  const clientAccountId = command.clientAccountId.trim();
  if (!clientAccountId) return failure(404, "client_not_found");
  if (!REQUEST_ID.test(command.requestId)) return failure(400, "invalid_request_id");
  const prepared = prepareCommand({ ...command, clientAccountId });
  if (!prepared.ok) return prepared.failure;
  try {
    return await db.$transaction(
      (tx) => applyCommand(tx, prepared.command, prepared.hash, recordedActor),
      TRANSACTION
    );
  } catch (error) {
    if (isUniqueConflict(error)) return failure(409, "registry_conflict");
    throw error;
  }
}

async function applyCommand(
  tx: Prisma.TransactionClient,
  command: RegistryCommand,
  hash: string,
  actor: string
): Promise<RegistryCommandResult> {
  await tx.$executeRaw`
    SELECT pg_advisory_xact_lock(hashtext('campaign-registry-request'), hashtext(${command.requestId}))
  `;
  const replay = await replayCommand(tx, command, hash);
  if (replay) return replay;

  const lockedClient = await tx.$queryRaw<Array<{ clientAccountId: string }>>`
    SELECT "clientAccountId"
    FROM "ClientAccount"
    WHERE "clientAccountId" = ${command.clientAccountId}
    FOR UPDATE
  `;
  if (lockedClient.length === 0) return failure(404, "client_not_found");

  if (command.intent === "create") return applyCreate(tx, command, hash, actor);
  const locked = await lockCampaign(tx, command.clientAccountId, command.campaignId);
  if (!locked.ok) return locked.failure;
  if (locked.revision !== command.expectedRevision) return failure(409, "revision_conflict");
  if (command.intent === "update") return applyUpdate(tx, command, hash, actor);
  if (command.intent === "save_bindings") return applyBindings(tx, command, hash, actor);
  return applyDestination(tx, command, hash, actor);
}

async function applyCreate(
  tx: Prisma.TransactionClient,
  command: CreateCampaignCommand,
  hash: string,
  actor: string
): Promise<RegistryCommandResult> {
  if (command.expectedRevision !== 0) return failure(409, "revision_conflict");
  const existing = await tx.clientCampaign.findUnique({
    where: { clientAccountId_slug: { clientAccountId: command.clientAccountId, slug: command.slug } },
    select: { id: true },
  });
  if (existing) return failure(409, "slug_conflict");
  const created = await tx.clientCampaign.create({
    data: {
      clientAccountId: command.clientAccountId,
      slug: command.slug,
      displayName: command.displayName,
      nicheKey: command.nicheKey,
      productType: command.productType,
      status: "draft",
      revision: 1,
      createdByActor: actor,
      updatedByActor: actor,
    },
  });
  const result: RegistryCommandResult = {
    ...BOUNDARY,
    ok: true,
    statusCode: 200,
    replayed: false,
    requestId: command.requestId,
    clientAccountId: command.clientAccountId,
    campaignId: created.id,
    revision: created.revision,
    campaign: campaignView(created),
    bindings: [],
    destination: null,
  };
  await storeCommand(tx, command, hash, actor, created.id, result);
  return result;
}

async function applyUpdate(
  tx: Prisma.TransactionClient,
  command: UpdateCampaignCommand,
  hash: string,
  actor: string
): Promise<RegistryCommandResult> {
  const updated = await tx.clientCampaign.update({
    where: { id: command.campaignId },
    data: {
      displayName: command.displayName,
      nicheKey: command.nicheKey,
      productType: command.productType,
      status: command.status as "draft" | "review" | "ready",
      revision: { increment: 1 },
      updatedByActor: actor,
    },
  });
  const result: RegistryCommandResult = {
    ...BOUNDARY,
    ok: true,
    statusCode: 200,
    replayed: false,
    requestId: command.requestId,
    clientAccountId: command.clientAccountId,
    campaignId: updated.id,
    revision: updated.revision,
    campaign: campaignView(updated),
  };
  await storeCommand(tx, command, hash, actor, updated.id, result);
  return result;
}

async function applyBindings(
  tx: Prisma.TransactionClient,
  command: SaveBindingsCommand,
  hash: string,
  actor: string
): Promise<RegistryCommandResult> {
  const prepared = prepareBindingSet(command.bindings);
  if (!prepared.ok) return prepared.failure;
  const loaded = await loadReferences(tx, command.clientAccountId, prepared.bindings);
  if (!loaded.ok) return loaded.failure;
  await lockIdentities(tx, prepared.bindings);
  const conflicts = await findConflicts(tx, command.clientAccountId, command.campaignId, prepared.bindings, loaded.funnels);
  if (conflicts.length > 0) {
    const campaign = await tx.clientCampaign.findUniqueOrThrow({ where: { id: command.campaignId } });
    const result: RegistryCommandResult = {
      ...BOUNDARY,
      ok: false,
      statusCode: 409,
      replayed: false,
      error: "review_required",
      outcome: "REVIEW_REQUIRED",
      requestId: command.requestId,
      clientAccountId: command.clientAccountId,
      campaignId: command.campaignId,
      revision: campaign.revision,
      conflicts,
    };
    await storeCommand(tx, command, hash, actor, command.campaignId, result);
    return result;
  }

  await replaceBindings(tx, command, prepared.bindings, actor);
  const campaign = await tx.clientCampaign.update({
    where: { id: command.campaignId },
    data: { revision: { increment: 1 }, updatedByActor: actor },
  });
  const graph = await tx.clientCampaign.findUniqueOrThrow({ where: { id: campaign.id }, include: campaignGraph });
  const view = graphView(graph);
  const result: RegistryCommandResult = {
    ...BOUNDARY,
    ok: true,
    statusCode: 200,
    replayed: false,
    requestId: command.requestId,
    clientAccountId: command.clientAccountId,
    campaignId: campaign.id,
    revision: view.campaign.revision,
    campaign: view.campaign,
    bindings: view.bindings,
    destination: view.destination,
  };
  await storeCommand(tx, command, hash, actor, campaign.id, result);
  return result;
}

async function applyDestination(
  tx: Prisma.TransactionClient,
  command: SaveDestinationCommand,
  hash: string,
  actor: string
): Promise<RegistryCommandResult> {
  const ghl = await tx.clientGhlDestination.findUnique({ where: { clientAccountId: command.clientAccountId } });
  const sheets = await tx.companySheetsDestination.findUnique({ where: { clientAccountId: command.clientAccountId } });
  const workflowId = cleanToken(command.workflowIdGhl, 200);
  const locationId = cleanToken(command.ghlLocationId, 200);
  const spreadsheetId = cleanToken(command.spreadsheetId, 200);
  const worksheetTitle = cleanLabel(command.worksheetTitle, 120);
  if (workflowId === "invalid" || locationId === "invalid" || spreadsheetId === "invalid" || worksheetTitle === "invalid") {
    return failure(400, "destination_invalid");
  }
  if (command.workflowTriggerMode && !TRIGGER_MODES.has(command.workflowTriggerMode)) {
    return failure(400, "destination_invalid");
  }
  if (command.workflowTriggerMode && !workflowId) return failure(400, "destination_invalid");
  if (worksheetTitle && command.worksheetId === null) return failure(400, "destination_invalid");
  if (command.worksheetId !== null && (!Number.isInteger(command.worksheetId) || command.worksheetId < 0)) {
    return failure(400, "destination_invalid");
  }
  if (locationId && (!ghl || ghl.destinationSubaccountIdGhl !== locationId)) {
    return failure(409, "ghl_location_mismatch");
  }
  if (spreadsheetId && (!sheets || sheets.spreadsheetId !== spreadsheetId)) {
    return failure(409, "spreadsheet_mismatch");
  }

  const warnings = destinationWarnings({
    hasGhl: Boolean(ghl),
    workflowId,
    hasSheets: Boolean(sheets),
    worksheetId: command.worksheetId,
  });
  const data = {
    clientGhlDestinationId: ghl?.id ?? null,
    ghlLocationId: ghl?.destinationSubaccountIdGhl ?? null,
    workflowIdGhl: workflowId,
    workflowTriggerMode: command.workflowTriggerMode,
    workflowLiveVerified: false,
    companySheetsDestinationId: sheets?.id ?? null,
    spreadsheetId: sheets?.spreadsheetId ?? null,
    worksheetId: command.worksheetId,
    worksheetTitle,
    mapPublished: false,
    readinessWarnings: warnings,
    actor,
  };
  const existing = await tx.clientCampaignDestinationSelection.findUnique({
    where: { clientCampaignId: command.campaignId },
  });
  if (existing) {
    await tx.clientCampaignDestinationSelection.update({
      where: { id: existing.id },
      data: { ...data, revision: { increment: 1 } },
    });
  } else {
    await tx.clientCampaignDestinationSelection.create({
      data: { ...data, clientCampaignId: command.campaignId, revision: 1 },
    });
  }
  const campaign = await tx.clientCampaign.update({
    where: { id: command.campaignId },
    data: { revision: { increment: 1 }, updatedByActor: actor },
  });
  const graph = await tx.clientCampaign.findUniqueOrThrow({ where: { id: campaign.id }, include: campaignGraph });
  const view = graphView(graph);
  const result: RegistryCommandResult = {
    ...BOUNDARY,
    ok: true,
    statusCode: 200,
    replayed: false,
    requestId: command.requestId,
    clientAccountId: command.clientAccountId,
    campaignId: campaign.id,
    revision: view.campaign.revision,
    campaign: view.campaign,
    bindings: view.bindings,
    destination: view.destination,
  };
  await storeCommand(tx, command, hash, actor, campaign.id, result);
  return result;
}

async function replaceBindings(
  tx: Prisma.TransactionClient,
  command: SaveBindingsCommand,
  bindings: PreparedBinding[],
  actor: string
): Promise<void> {
  const existing = await tx.clientCampaignSourceBinding.findMany({ where: { clientCampaignId: command.campaignId } });
  const incoming = new Set(bindings.map((binding) => binding.bindingKey));
  for (const row of existing) {
    if (row.status === "superseded" || incoming.has(row.bindingKey)) continue;
    await tx.clientCampaignSourceIdentity.updateMany({
      where: { bindingId: row.id },
      data: { active: false, bindingStatus: "superseded" },
    });
    await tx.clientCampaignSourceBinding.update({
      where: { id: row.id },
      data: { status: "superseded", revision: { increment: 1 }, actor },
    });
  }
  for (const binding of bindings) {
    const current = existing.find((row) => row.bindingKey === binding.bindingKey);
    const status = binding.requestedStatus;
    const shared = {
      sourceFunnelId: binding.sourceFunnelId,
      campaignRoutingRuleId: binding.campaignRoutingRuleId,
      evidenceJson: evidenceData(binding.evidence),
      status,
      actor,
    };
    const bindingId = current
      ? (
          await tx.clientCampaignSourceBinding.update({
            where: { id: current.id },
            data: { ...shared, revision: { increment: 1 } },
          })
        ).id
      : (
          await tx.clientCampaignSourceBinding.create({
            data: { ...shared, clientCampaignId: command.campaignId, bindingKey: binding.bindingKey, revision: 1 },
          })
        ).id;
    if (current) {
      await tx.clientCampaignSourceIdentity.updateMany({
        where: { bindingId: current.id },
        data: { active: false, bindingStatus: "superseded" },
      });
    }
    if (binding.identities.length > 0) {
      await tx.clientCampaignSourceIdentity.createMany({
        data: binding.identities.map((identity) => ({
          bindingId,
          clientCampaignId: command.campaignId,
          clientAccountId: command.clientAccountId,
          provider: identity.provider,
          kind: identity.kind,
          normalizedValue: identity.normalizedValue,
          active: true,
          bindingStatus: status,
        })),
      });
    }
  }
}

async function findConflicts(
  tx: Prisma.TransactionClient,
  clientAccountId: string,
  campaignId: string,
  bindings: PreparedBinding[],
  funnels: Map<string, FunnelRow>
): Promise<RegistryConflict[]> {
  const conflicts: RegistryConflict[] = [];
  for (const binding of bindings) {
    if (binding.requestedStatus === "approved" && binding.sourceFunnelId) {
      const funnel = funnels.get(binding.sourceFunnelId);
      if (!funnel || funnel.associationStatus !== "confirmed" || funnel.originClientAccountId !== clientAccountId) {
        conflicts.push({
          code: "source_not_confirmed",
          scope: "unconfirmed",
          identifierKind: binding.identities[0]?.kind ?? "provider_funnel_id",
          bindingKey: binding.bindingKey,
        });
      }
    }
    for (const identity of binding.identities) {
      const overlaps = await tx.clientCampaignSourceIdentity.findMany({
        where: {
          active: true,
          provider: identity.provider,
          kind: identity.kind,
          normalizedValue: identity.normalizedValue,
          clientCampaignId: { not: campaignId },
        },
        select: { clientAccountId: true, clientCampaignId: true },
      });
      for (const overlap of overlaps) {
        const conflict = publicExactOverlap({
          kind: identity.kind,
          ownerClientAccountId: overlap.clientAccountId,
          ownerCampaignId: overlap.clientCampaignId,
          currentClientAccountId: clientAccountId,
        });
        conflicts.push({ ...conflict, bindingKey: binding.bindingKey });
      }
      if (await otherRoutingAuthority(tx, clientAccountId, identity)) {
        conflicts.push({
          code: "routing_authority_overlap",
          scope: "other_client",
          identifierKind: identity.kind,
          bindingKey: binding.bindingKey,
        });
      }
      if (await otherSourceOwnership(tx, clientAccountId, identity)) {
        conflicts.push({
          code: "source_ownership_overlap",
          scope: "other_client",
          identifierKind: identity.kind,
          bindingKey: binding.bindingKey,
        });
      }
    }
  }
  return dedupeConflicts(conflicts);
}

async function otherRoutingAuthority(
  tx: Prisma.TransactionClient,
  clientAccountId: string,
  identity: IdentityDraft
): Promise<boolean> {
  const where = routingOverlapWhere(clientAccountId, identity);
  if (!where) return false;
  const found = await tx.campaignRoutingRule.findFirst({ where, select: { id: true } });
  return found !== null;
}

function routingOverlapWhere(clientAccountId: string, identity: IdentityDraft): Prisma.CampaignRoutingRuleWhereInput | null {
  const other = { clientAccountId: { not: clientAccountId } };
  if (identity.kind === "campaign_id") return { ...other, matchType: "campaign_id", campaignId: identity.normalizedValue };
  if (identity.kind === "adset_id") return { ...other, matchType: "adset_id", adsetId: identity.normalizedValue };
  if (identity.kind === "ad_id") return { ...other, matchType: "ad_id", adId: identity.normalizedValue };
  if (identity.kind === "form_id") return { ...other, matchType: "form_id_utm_campaign", formId: identity.normalizedValue };
  return null;
}

async function otherSourceOwnership(
  tx: Prisma.TransactionClient,
  clientAccountId: string,
  identity: IdentityDraft
): Promise<boolean> {
  if (identity.kind !== "provider_funnel_id" && identity.kind !== "parent_url_key") return false;
  const found = await tx.sourceFunnel.findFirst({
    where: {
      provider: identity.provider,
      ...(identity.kind === "provider_funnel_id"
        ? { providerFunnelId: identity.normalizedValue }
        : { parentUrlKey: identity.normalizedValue }),
      AND: [{ originClientAccountId: { not: null } }, { originClientAccountId: { not: clientAccountId } }],
    },
    select: { id: true },
  });
  return found !== null;
}

type FunnelRow = {
  id: string;
  provider: IdentityDraft["provider"];
  providerFunnelId: string | null;
  parentUrlKey: string | null;
  associationStatus: string;
  originClientAccountId: string | null;
  suggestedClientAccountId: string | null;
};

type RuleRow = {
  id: string;
  clientAccountId: string;
  matchType: "campaign_id" | "adset_id" | "ad_id" | "form_id_utm_campaign" | "utm_campaign" | "keyword_fallback";
  campaignId: string | null;
  adsetId: string | null;
  adId: string | null;
  formId: string | null;
};

async function loadReferences(
  tx: Prisma.TransactionClient,
  clientAccountId: string,
  bindings: PreparedBinding[]
): Promise<{ ok: true; funnels: Map<string, FunnelRow> } | { ok: false; failure: RegistryCommandResult }> {
  const funnelIds = [...new Set(bindings.flatMap((binding) => (binding.sourceFunnelId ? [binding.sourceFunnelId] : [])))];
  const ruleIds = [...new Set(bindings.flatMap((binding) => (binding.campaignRoutingRuleId ? [binding.campaignRoutingRuleId] : [])))];
  const funnels = new Map<string, FunnelRow>();
  if (funnelIds.length > 0) {
    const rows = await tx.sourceFunnel.findMany({
      where: { id: { in: funnelIds } },
      select: {
        id: true,
        provider: true,
        providerFunnelId: true,
        parentUrlKey: true,
        associationStatus: true,
        originClientAccountId: true,
        suggestedClientAccountId: true,
      },
    });
    for (const row of rows) funnels.set(row.id, row);
  }
  const rules = new Map<string, RuleRow>();
  if (ruleIds.length > 0) {
    const rows = await tx.campaignRoutingRule.findMany({
      where: { id: { in: ruleIds } },
      select: {
        id: true,
        clientAccountId: true,
        matchType: true,
        campaignId: true,
        adsetId: true,
        adId: true,
        formId: true,
      },
    });
    for (const row of rows) rules.set(row.id, row);
  }
  for (const binding of bindings) {
    const problem = referenceProblem(binding, clientAccountId, funnels, rules);
    if (problem) return { ok: false, failure: problem };
  }
  return { ok: true, funnels };
}

function referenceProblem(
  binding: PreparedBinding,
  clientAccountId: string,
  funnels: Map<string, FunnelRow>,
  rules: Map<string, RuleRow>
): RegistryCommandResult | null {
  if (binding.sourceFunnelId) {
    const funnel = funnels.get(binding.sourceFunnelId);
    if (!funnel) return failure(404, "unknown_source");
    const ownedByOther =
      (funnel.originClientAccountId !== null && funnel.originClientAccountId !== clientAccountId) ||
      (funnel.originClientAccountId === null &&
        funnel.suggestedClientAccountId !== null &&
        funnel.suggestedClientAccountId !== clientAccountId);
    if (ownedByOther) return failure(409, "foreign_source");
    if (binding.identities.length > 0 && binding.identities.some((identity) => identity.provider !== funnel.provider)) {
      return failure(409, "identifier_inconsistent");
    }
    if (!consistentWithFunnel(binding, funnel)) return failure(409, "identifier_inconsistent");
  }
  if (binding.campaignRoutingRuleId) {
    const rule = rules.get(binding.campaignRoutingRuleId);
    if (!rule) return failure(404, "unknown_routing_rule");
    if (rule.clientAccountId !== clientAccountId) return failure(409, "foreign_routing_rule");
    if (isLooseRoutingMatch(rule.matchType)) return failure(409, "utm_or_keyword_not_authority");
    const expected = exactRuleIdentity(rule);
    if (!expected) return failure(409, "identifier_inconsistent");
    const matched = binding.identities.some(
      (identity) => identity.kind === expected.kind && identity.normalizedValue === expected.value
    );
    if (!matched) return failure(409, "identifier_inconsistent");
  }
  return null;
}

function consistentWithFunnel(binding: PreparedBinding, funnel: FunnelRow): boolean {
  return funnelIdentifierConsistent({
    requestedStatus: binding.requestedStatus,
    identities: binding.identities,
    providerFunnelId: funnel.providerFunnelId,
    parentUrlKey: funnel.parentUrlKey,
  });
}

function exactRuleIdentity(rule: RuleRow): { kind: IdentifierKind; value: string } | null {
  if (rule.matchType === "campaign_id" && rule.campaignId?.trim()) return { kind: "campaign_id", value: rule.campaignId.trim() };
  if (rule.matchType === "adset_id" && rule.adsetId?.trim()) return { kind: "adset_id", value: rule.adsetId.trim() };
  if (rule.matchType === "ad_id" && rule.adId?.trim()) return { kind: "ad_id", value: rule.adId.trim() };
  if (rule.matchType === "form_id_utm_campaign" && rule.formId?.trim()) return { kind: "form_id", value: rule.formId.trim() };
  return null;
}

function prepareBindingSet(
  bindings: BindingDraft[]
): { ok: true; bindings: PreparedBinding[] } | { ok: false; failure: RegistryCommandResult } {
  if (bindings.length > 20) return { ok: false, failure: failure(400, "too_many_bindings") };
  const keys = new Set<string>();
  const prepared: PreparedBinding[] = [];
  for (const binding of bindings) {
    if (keys.has(binding.bindingKey)) return { ok: false, failure: failure(409, "duplicate_identifier") };
    keys.add(binding.bindingKey);
    const result = prepareBinding(binding);
    if (!result.ok) return { ok: false, failure: failure(result.statusCode, result.error) };
    prepared.push(result.binding);
  }
  if (duplicateIdentityInSet(prepared)) return { ok: false, failure: failure(409, "duplicate_identifier") };
  prepared.sort((left, right) => left.bindingKey.localeCompare(right.bindingKey));
  return { ok: true, bindings: prepared };
}

async function lockIdentities(tx: Prisma.TransactionClient, bindings: PreparedBinding[]): Promise<void> {
  const keys = [...new Set(bindings.flatMap((binding) => binding.identities.map(identityKey)))].sort();
  for (const key of keys) {
    await tx.$executeRaw`
      SELECT pg_advisory_xact_lock(hashtext('campaign-registry-identity'), hashtext(${key}))
    `;
  }
}

async function lockCampaign(
  tx: Prisma.TransactionClient,
  clientAccountId: string,
  campaignId: string
): Promise<{ ok: true; revision: number } | { ok: false; failure: RegistryCommandResult }> {
  const rows = await tx.$queryRaw<Array<{ id: string; revision: number }>>`
    SELECT "id", "revision"
    FROM "ClientCampaign"
    WHERE "id" = ${campaignId} AND "clientAccountId" = ${clientAccountId}
    FOR UPDATE
  `;
  const row = rows[0];
  if (!row) return { ok: false, failure: failure(404, "campaign_not_found") };
  return { ok: true, revision: row.revision };
}

async function replayCommand(
  tx: Prisma.TransactionClient,
  command: RegistryCommand,
  hash: string
): Promise<RegistryCommandResult | null> {
  const existing = await tx.clientCampaignRegistryCommand.findUnique({ where: { requestId: command.requestId } });
  if (!existing) return null;
  if (existing.payloadHash !== hash || existing.clientAccountId !== command.clientAccountId) {
    return failure(409, "request_id_conflict");
  }
  const snapshot = readSnapshot(existing.resultJson);
  if (!snapshot) return failure(409, "unreadable_result");
  return { ...snapshot.body, replayed: true, statusCode: snapshot.statusCode };
}

async function storeCommand(
  tx: Prisma.TransactionClient,
  command: RegistryCommand,
  hash: string,
  actor: string,
  clientCampaignId: string,
  result: RegistryCommandResult
): Promise<void> {
  await tx.clientCampaignRegistryCommand.create({
    data: {
      requestId: command.requestId,
      clientAccountId: command.clientAccountId,
      historicalClientAccountId: command.clientAccountId,
      clientCampaignId,
      action: command.intent,
      expectedRevision: command.expectedRevision,
      payloadHash: hash,
      resultJson: snapshotOf(result),
      actor,
    },
  });
}

function prepareCommand(
  command: RegistryCommand
): { ok: true; command: RegistryCommand; hash: string } | { ok: false; failure: RegistryCommandResult } {
  if (command.intent === "create") {
    const slug = command.slug.trim();
    const displayName = command.displayName.trim();
    if (!SLUG.test(slug) || slug.length > 80) return { ok: false, failure: failure(400, "slug_invalid") };
    if (!displayName || displayName.length > 120) return { ok: false, failure: failure(400, "display_name_invalid") };
    if (!isCampaignNicheKey(command.nicheKey) || !isCampaignProductType(command.productType)) {
      return { ok: false, failure: failure(400, "catalog_rejected") };
    }
    const normalized: CreateCampaignCommand = { ...command, slug, displayName };
    return { ok: true, command: normalized, hash: hashPayload(canonical(normalized)) };
  }
  if (command.intent === "update") {
    const displayName = command.displayName.trim();
    if (!displayName || displayName.length > 120) return { ok: false, failure: failure(400, "display_name_invalid") };
    if (!isCampaignNicheKey(command.nicheKey) || !isCampaignProductType(command.productType)) {
      return { ok: false, failure: failure(400, "catalog_rejected") };
    }
    if (!WRITABLE_STATUS.has(command.status)) return { ok: false, failure: failure(400, "status_not_writable") };
    const normalized: UpdateCampaignCommand = { ...command, displayName };
    return { ok: true, command: normalized, hash: hashPayload(canonical(normalized)) };
  }
  if (command.intent === "save_bindings") {
    const normalized: SaveBindingsCommand = {
      ...command,
      bindings: [...command.bindings].sort((left, right) => left.bindingKey.localeCompare(right.bindingKey)),
    };
    return { ok: true, command: normalized, hash: hashPayload(canonical(normalized)) };
  }
  return { ok: true, command, hash: hashPayload(canonical(command)) };
}

function canonical(command: RegistryCommand): unknown {
  if (command.intent === "save_bindings") {
    return {
      action: command.intent,
      clientAccountId: command.clientAccountId,
      campaignId: command.campaignId,
      expectedRevision: command.expectedRevision,
      bindings: command.bindings.map((binding) => ({
        bindingKey: binding.bindingKey,
        requestedStatus: binding.requestedStatus,
        sourceFunnelId: binding.sourceFunnelId,
        campaignRoutingRuleId: binding.campaignRoutingRuleId,
        provider: binding.provider,
        providerFunnelId: binding.providerFunnelId,
        parentUrlKey: binding.parentUrlKey,
        campaignId: binding.campaignId,
        formId: binding.formId,
        adsetId: binding.adsetId,
        adId: binding.adId,
        note: binding.evidence?.note ?? null,
        observedLabel: binding.evidence?.observedLabel ?? null,
      })),
    };
  }
  if (command.intent === "create") {
    return {
      action: command.intent,
      clientAccountId: command.clientAccountId,
      expectedRevision: command.expectedRevision,
      slug: command.slug,
      displayName: command.displayName,
      nicheKey: command.nicheKey,
      productType: command.productType,
    };
  }
  if (command.intent === "update") {
    return {
      action: command.intent,
      clientAccountId: command.clientAccountId,
      campaignId: command.campaignId,
      expectedRevision: command.expectedRevision,
      displayName: command.displayName,
      nicheKey: command.nicheKey,
      productType: command.productType,
      status: command.status,
    };
  }
  return {
    action: command.intent,
    clientAccountId: command.clientAccountId,
    campaignId: command.campaignId,
    expectedRevision: command.expectedRevision,
    workflowIdGhl: command.workflowIdGhl,
    workflowTriggerMode: command.workflowTriggerMode,
    ghlLocationId: command.ghlLocationId,
    spreadsheetId: command.spreadsheetId,
    worksheetId: command.worksheetId,
    worksheetTitle: command.worksheetTitle,
  };
}

const campaignGraph = {
  bindings: {
    where: { status: { not: "superseded" as const } },
    orderBy: { bindingKey: "asc" as const },
    include: {
      identities: {
        where: { active: true },
        orderBy: [{ kind: "asc" as const }, { normalizedValue: "asc" as const }],
      },
    },
  },
  destination: true,
} satisfies Prisma.ClientCampaignInclude;

type CampaignGraph = Prisma.ClientCampaignGetPayload<{ include: typeof campaignGraph }>;

function graphView(campaign: CampaignGraph): {
  campaign: CampaignView;
  bindings: BindingView[];
  destination: DestinationView | null;
} {
  return {
    campaign: campaignView(campaign),
    bindings: campaign.bindings.map(bindingView),
    destination: campaign.destination ? destinationView(campaign.destination) : null,
  };
}

function campaignView(row: {
  id: string;
  clientAccountId: string;
  slug: string;
  displayName: string;
  nicheKey: string;
  productType: string;
  status: string;
  revision: number;
  createdAt: Date;
  updatedAt: Date;
}): CampaignView {
  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    slug: row.slug,
    displayName: row.displayName,
    nicheKey: row.nicheKey,
    productType: row.productType,
    status: row.status,
    revision: row.revision,
    configurationStatusEffect: "none",
    operationalReady: false,
    inventoryKeyUsed: false,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function bindingView(row: CampaignGraph["bindings"][number]): BindingView {
  const evidence = row.evidenceJson;
  const record = evidence && typeof evidence === "object" && !Array.isArray(evidence) ? evidence : {};
  return {
    id: row.id,
    bindingKey: row.bindingKey,
    status: row.status,
    revision: row.revision,
    sourceFunnelId: row.sourceFunnelId,
    campaignRoutingRuleId: row.campaignRoutingRuleId,
    identities: row.identities.map((identity) => ({
      provider: identity.provider,
      kind: identity.kind,
      normalizedValue: identity.normalizedValue,
    })),
    recordedEvidence: {
      note: typeof record.note === "string" ? record.note : null,
      observedLabel: typeof record.observedLabel === "string" ? record.observedLabel : null,
      usedAsJoinKey: false,
    },
    originConfirmed: false,
  };
}

function destinationView(row: NonNullable<CampaignGraph["destination"]>): DestinationView {
  return {
    id: row.id,
    revision: row.revision,
    ghlLocationId: row.ghlLocationId,
    workflowIdGhl: row.workflowIdGhl,
    workflowTriggerMode: row.workflowTriggerMode,
    workflowLiveVerified: false,
    spreadsheetId: row.spreadsheetId,
    worksheetId: row.worksheetId,
    worksheetTitle: row.worksheetTitle,
    mapPublished: false,
    readinessWarnings: warningList(row.readinessWarnings),
    operationalReady: false,
    changedClientDefaultWorkflow: false,
    tabContractChanged: false,
  };
}

function warningList(value: Prisma.JsonValue): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function evidenceData(evidence: PreparedBinding["evidence"]): Prisma.InputJsonObject {
  const data: Record<string, string> = {};
  if (evidence.note) data.note = evidence.note;
  if (evidence.observedLabel) data.observedLabel = evidence.observedLabel;
  return data;
}

function destinationWarnings(input: {
  hasGhl: boolean;
  workflowId: string | null;
  hasSheets: boolean;
  worksheetId: number | null;
}): string[] {
  const warnings = ["selection_is_not_operational", "not_a_published_map"];
  if (!input.hasGhl) warnings.push("ghl_destination_missing");
  if (input.workflowId) warnings.push("workflow_not_live_verified");
  if (!input.hasSheets) warnings.push("sheets_destination_missing");
  if (input.worksheetId !== null) warnings.push("worksheet_not_verified");
  return warnings;
}

function cleanToken(value: string | null, max: number): string | null | "invalid" {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max || /\s/.test(trimmed)) return "invalid";
  return trimmed;
}

function cleanLabel(value: string | null, max: number): string | null | "invalid" {
  if (value === null) return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > max) return "invalid";
  return trimmed;
}

function dedupeConflicts(conflicts: RegistryConflict[]): RegistryConflict[] {
  const seen = new Set<string>();
  const unique: RegistryConflict[] = [];
  for (const conflict of conflicts) {
    const key = JSON.stringify(conflict);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(conflict);
  }
  return unique;
}

function snapshotOf(result: RegistryCommandResult): Prisma.InputJsonObject {
  return { version: 1, statusCode: result.statusCode, body: result as unknown as Prisma.InputJsonObject };
}

function readSnapshot(value: Prisma.JsonValue): StoredSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.version !== 1) return null;
  if (row.statusCode !== 200 && row.statusCode !== 409) return null;
  if (!row.body || typeof row.body !== "object" || Array.isArray(row.body)) return null;
  const body = row.body as RegistryCommandResult;
  if (body.routingRuleApplied !== false || body.sourceConfirmed !== false || body.deliveryArmed !== false) return null;
  if (body.externalCall !== false || body.operationalReady !== false || body.originConfirmed !== false) return null;
  if (body.changedClientDefaultWorkflow !== false || body.tabContractChanged !== false) return null;
  return { version: 1, statusCode: row.statusCode, body: { ...body, replayed: false } };
}

function failure(statusCode: RegistryCommandResult["statusCode"], error: string): RegistryCommandResult {
  return { ...BOUNDARY, ok: false, statusCode, error, replayed: false };
}

function hashPayload(value: unknown): string {
  return createHash("sha256").update(stableString(value)).digest("hex");
}

function stableString(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map((item) => stableString(item)).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([left], [right]) =>
    left < right ? -1 : left > right ? 1 : 0
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableString(item)}`).join(",")}}`;
}

function isUniqueConflict(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}

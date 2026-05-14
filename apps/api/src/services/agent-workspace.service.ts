import type {
  GuidanceResource,
  InboundContactIndex,
  LeadAttribution,
  LifecycleEvent,
  ObjectionPlaybook,
  Prisma,
  WebhookRequestLog,
} from "@prisma/client";
import { GuidanceResourceType, WebhookRequestSource } from "@prisma/client";
import { redactWebhookPayloadForLog } from "@sa360/shared";
import { getGhlLocationId } from "../lib/ghl-contact-lookup-env.js";
import { prisma } from "../lib/db.js";
import { GHL_LIFECYCLE_ROUTE } from "./webhook-request-log.service.js";
import {
  findByContactIdGhl,
  findByLeadUid,
  type InboundContactLookupScope,
} from "../repositories/inbound-contact-index.repository.js";
import type { ContactGuidanceEventBody, WhatHappenedBody } from "../schemas/agent-workspace.schema.js";
import { finalizeWhatHappenedGhlSync } from "./ghl-sync.service.js";

/** Default lifecycle stages for lead queue when `lifecycleStages` query is omitted. */
export const DEFAULT_LEAD_QUEUE_LIFECYCLE_STAGES = [
  "ATTEMPTING_CONTACT",
  "NEW",
  "FOLLOW_UP",
  "Attempting Contact",
  "New Lead",
  "Follow Up",
  "attempting_contact",
  "new",
  "follow_up",
] as const;

export function resolveWorkspaceSubaccountIdGhl(input: {
  subaccountIdGhl?: string;
  locationId?: string;
}): string {
  const sub = input.subaccountIdGhl?.trim();
  if (sub !== undefined && sub !== "") {
    return sub;
  }
  const loc = input.locationId?.trim();
  if (loc !== undefined && loc !== "") {
    return loc;
  }
  return "";
}

function pickStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return undefined;
}

/** Extract GHL lifecycle `state` + contact ids from stored `payloadJson`. */
export function extractLifecycleSnapshotFromPayload(payload: unknown): {
  lifecycleStage?: string;
  appointmentStatus?: string;
  policyStatus?: string;
  leadStatus?: string;
  agentDisposition?: string;
  leadType?: string;
  contactIdGhl?: string;
  leadUid?: string;
  assignedAgentId?: string;
  assignedAgentName?: string;
} {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return {};
  }
  const p = payload as Record<string, unknown>;
  const contact = p.contact as Record<string, unknown> | undefined;
  const state = p.state as Record<string, unknown> | undefined;
  const ownership = p.ownership as Record<string, unknown> | undefined;

  const lifecycleStage = pickStr(state?.lifecycle_stage ?? state?.lifecycleStage);
  const appointmentStatus = pickStr(
    state?.appointment_status ?? state?.appointmentStatus
  );
  const policyStatus = pickStr(state?.policy_status ?? state?.policyStatus);
  const leadStatus = pickStr(state?.lead_status ?? state?.leadStatus);
  const agentDisposition = pickStr(
    state?.agent_disposition ?? state?.agentDisposition
  );
  const leadType = pickStr(state?.lead_type ?? state?.leadType);

  const contactIdGhl = pickStr(contact?.contact_id_ghl ?? contact?.contactIdGhl);
  const leadUid = pickStr(contact?.lead_uid ?? contact?.leadUid);

  const assignedAgentId = pickStr(
    ownership?.assigned_agent_id ?? ownership?.assignedAgentId
  );
  const assignedAgentName = pickStr(
    ownership?.assigned_agent_name ?? ownership?.assignedAgentName
  );

  return {
    lifecycleStage,
    appointmentStatus,
    policyStatus,
    leadStatus,
    agentDisposition,
    leadType,
    contactIdGhl,
    leadUid,
    assignedAgentId,
    assignedAgentName,
  };
}

function indexScope(
  clientAccountId: string,
  subaccountIdGhl: string
): InboundContactLookupScope {
  return { clientAccountId, subaccountIdGhl };
}

async function loadInboundIndex(args: {
  clientAccountId: string;
  subaccountIdGhl: string;
  contactIdGhl?: string;
  leadUid?: string;
}): Promise<InboundContactIndex | null> {
  const scope = indexScope(args.clientAccountId, args.subaccountIdGhl);
  if (args.contactIdGhl?.trim()) {
    const row = await findByContactIdGhl(args.contactIdGhl.trim(), scope);
    if (row) {
      return row;
    }
  }
  if (args.leadUid?.trim()) {
    const row = await findByLeadUid(args.leadUid.trim(), scope);
    if (row) {
      return row;
    }
  }
  if (args.contactIdGhl?.trim()) {
    return findByContactIdGhl(args.contactIdGhl.trim(), { clientAccountId: args.clientAccountId });
  }
  if (args.leadUid?.trim()) {
    return findByLeadUid(args.leadUid.trim(), { clientAccountId: args.clientAccountId });
  }
  return null;
}

function serializeInboundIndex(row: InboundContactIndex) {
  return {
    id: row.id,
    clientAccountId: row.clientAccountId,
    subaccountIdGhl: row.subaccountIdGhl,
    phoneE164: row.phoneE164,
    leadUid: row.leadUid,
    contactIdGhl: row.contactIdGhl,
    firstName: row.firstName,
    lastName: row.lastName,
    displayName: row.displayName,
    email: row.email,
    state: row.state,
    assignedAgentId: row.assignedAgentId,
    assignedAgentName: row.assignedAgentName,
    lifecycleStage: row.lifecycleStage,
    appointmentStatus: row.appointmentStatus,
    policyStatus: row.policyStatus,
    leadType: row.leadType,
    sourceOrigin: row.sourceOrigin,
    clientStatus: row.clientStatus,
    lastSeenAt: row.lastSeenAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function serializeLifecycleEvent(
  e: Pick<
    LifecycleEvent,
    | "id"
    | "eventUuid"
    | "eventNameInternal"
    | "eventNameMeta"
    | "leadUid"
    | "contactIdGhl"
    | "subaccountIdGhl"
    | "status"
    | "receivedAt"
    | "payloadJson"
  >
) {
  return {
    id: e.id,
    eventUuid: e.eventUuid,
    eventNameInternal: e.eventNameInternal,
    eventNameMeta: e.eventNameMeta,
    leadUid: e.leadUid,
    contactIdGhl: e.contactIdGhl,
    subaccountIdGhl: e.subaccountIdGhl,
    status: e.status,
    receivedAt: e.receivedAt.toISOString(),
    snapshot: extractLifecycleSnapshotFromPayload(e.payloadJson),
  };
}

function serializeWebhookLogRow(
  w: Pick<
    WebhookRequestLog,
    | "id"
    | "requestId"
    | "source"
    | "route"
    | "receivedAt"
    | "processingStatus"
    | "httpStatus"
    | "eventUuid"
    | "eventNameInternal"
    | "errorCode"
    | "errorSummary"
    | "durationMs"
    | "contactIdGhl"
  >
) {
  return {
    id: w.id,
    requestId: w.requestId,
    source: w.source,
    route: w.route,
    receivedAt: w.receivedAt.toISOString(),
    processingStatus: w.processingStatus,
    httpStatus: w.httpStatus,
    eventUuid: w.eventUuid,
    eventNameInternal: w.eventNameInternal,
    errorCode: w.errorCode,
    errorSummary: w.errorSummary,
    durationMs: w.durationMs,
  };
}

export async function fetchAgentWorkspaceContext(args: {
  clientAccountId: string;
  subaccountIdGhl: string;
  contactIdGhl?: string;
  leadUid?: string;
}) {
  const { clientAccountId, subaccountIdGhl } = args;
  const contactId = args.contactIdGhl?.trim() || undefined;
  const leadUid = args.leadUid?.trim() || undefined;

  const [clientConfig, inboundIndex, attribution] = await Promise.all([
    prisma.clientConfig.findUnique({
      where: { clientAccountId },
      select: { clientAccountId: true, clientName: true, defaultCurrency: true },
    }),
    loadInboundIndex({
      clientAccountId,
      subaccountIdGhl,
      contactIdGhl: contactId,
      leadUid,
    }),
    leadUid
      ? prisma.leadAttribution.findUnique({
          where: { leadUid },
        })
      : contactId
        ? prisma.leadAttribution.findFirst({
            where: { contactIdGhl: contactId },
          })
        : Promise.resolve(null),
  ]);

  const recentLifecycleEvents =
    contactId || leadUid
      ? await prisma.lifecycleEvent.findMany({
          where: {
            clientAccountId,
            OR: [
              ...(contactId ? [{ contactIdGhl: contactId }] : []),
              ...(leadUid ? [{ leadUid }] : []),
            ],
          },
          orderBy: { receivedAt: "desc" },
          take: 30,
          select: {
            id: true,
            eventUuid: true,
            eventNameInternal: true,
            eventNameMeta: true,
            leadUid: true,
            contactIdGhl: true,
            subaccountIdGhl: true,
            status: true,
            receivedAt: true,
            payloadJson: true,
          },
        })
      : [];

  const latestPayload =
    recentLifecycleEvents.length > 0 ? recentLifecycleEvents[0].payloadJson : null;
  const fromPayload = extractLifecycleSnapshotFromPayload(latestPayload);

  let recentWebhookLogs: Parameters<typeof serializeWebhookLogRow>[0][] = [];
  if (contactId) {
    recentWebhookLogs = await prisma.webhookRequestLog.findMany({
      where: {
        clientAccountId,
        source: WebhookRequestSource.ghl_lifecycle,
        route: GHL_LIFECYCLE_ROUTE,
        contactIdGhl: contactId,
      },
      orderBy: { receivedAt: "desc" },
      take: 20,
      select: {
        id: true,
        requestId: true,
        source: true,
        route: true,
        receivedAt: true,
        processingStatus: true,
        httpStatus: true,
        eventUuid: true,
        eventNameInternal: true,
        errorCode: true,
        errorSummary: true,
        durationMs: true,
        contactIdGhl: true,
      },
    });
  } else if (leadUid) {
    const candidates = await prisma.webhookRequestLog.findMany({
      where: {
        clientAccountId,
        source: WebhookRequestSource.ghl_lifecycle,
        route: GHL_LIFECYCLE_ROUTE,
      },
      orderBy: { receivedAt: "desc" },
      take: 120,
      select: {
        id: true,
        requestId: true,
        source: true,
        route: true,
        receivedAt: true,
        processingStatus: true,
        httpStatus: true,
        eventUuid: true,
        eventNameInternal: true,
        errorCode: true,
        errorSummary: true,
        durationMs: true,
        contactIdGhl: true,
        requestBodyRedacted: true,
      },
    });
    recentWebhookLogs = candidates
      .filter((w) => {
        const body = w.requestBodyRedacted;
        if (!body || typeof body !== "object" || Array.isArray(body)) {
          return false;
        }
        const c = (body as Record<string, unknown>).contact as Record<string, unknown> | undefined;
        const uid = c?.lead_uid ?? c?.leadUid;
        return typeof uid === "string" && uid === leadUid;
      })
      .slice(0, 20)
      .map((w) => ({
        id: w.id,
        requestId: w.requestId,
        source: w.source,
        route: w.route,
        receivedAt: w.receivedAt,
        processingStatus: w.processingStatus,
        httpStatus: w.httpStatus,
        eventUuid: w.eventUuid,
        eventNameInternal: w.eventNameInternal,
        errorCode: w.errorCode,
        errorSummary: w.errorSummary,
        durationMs: w.durationMs,
        contactIdGhl: w.contactIdGhl,
      }));
  }

  const lifecycleFields = {
    lifecycleStage: inboundIndex?.lifecycleStage ?? fromPayload.lifecycleStage,
    appointmentStatus: inboundIndex?.appointmentStatus ?? fromPayload.appointmentStatus,
    policyStatus: inboundIndex?.policyStatus ?? fromPayload.policyStatus,
    leadStatus: fromPayload.leadStatus,
    agentDisposition: fromPayload.agentDisposition,
    leadType: inboundIndex?.leadType ?? fromPayload.leadType,
  };

  const identity = {
    leadUid: inboundIndex?.leadUid ?? leadUid ?? fromPayload.leadUid,
    contactIdGhl: inboundIndex?.contactIdGhl ?? contactId ?? fromPayload.contactIdGhl,
    displayName: inboundIndex?.displayName ?? undefined,
    phoneE164: inboundIndex?.phoneE164 ?? undefined,
    email: inboundIndex?.email ?? undefined,
    firstName: inboundIndex?.firstName ?? undefined,
    lastName: inboundIndex?.lastName ?? undefined,
  };

  const assignedAgent = {
    assignedAgentId: inboundIndex?.assignedAgentId ?? fromPayload.assignedAgentId,
    assignedAgentName: inboundIndex?.assignedAgentName ?? fromPayload.assignedAgentName,
  };

  return {
    ok: true as const,
    clientAccountId,
    subaccountIdGhl,
    clientConfig,
    inboundContactIndex: inboundIndex ? serializeInboundIndex(inboundIndex) : null,
    identity,
    lifecycle: lifecycleFields,
    attribution: attribution ? serializeAttribution(attribution) : null,
    assignedAgent,
    recentLifecycleEvents: recentLifecycleEvents.map(serializeLifecycleEvent),
    recentWebhookLogs: recentWebhookLogs.map(serializeWebhookLogRow),
  };
}

function serializeAttribution(a: LeadAttribution) {
  return {
    leadUid: a.leadUid,
    contactIdGhl: a.contactIdGhl,
    sourcePlatform: a.sourcePlatform,
    sourceType: a.sourceType,
    campaignId: a.campaignId,
    campaignName: a.campaignName,
    adsetId: a.adsetId,
    adsetName: a.adsetName,
    adId: a.adId,
    adName: a.adName,
    utmSource: a.utmSource,
    utmMedium: a.utmMedium,
    utmCampaign: a.utmCampaign,
    utmContent: a.utmContent,
    utmTerm: a.utmTerm,
    firstTouchAt: a.firstTouchAt?.toISOString() ?? null,
    latestTouchAt: a.latestTouchAt?.toISOString() ?? null,
  };
}

/** Heuristic next step for queue rows and post-call guidance. */
export function deriveNextBestAction(input: {
  lifecycleStage?: string | null;
  appointmentStatus?: string | null;
  policyStatus?: string | null;
  agentDisposition?: string | null;
}): string {
  const apt = (input.appointmentStatus ?? "").toLowerCase();
  if (apt.includes("show") || apt.includes("confirmed") || apt.includes("set")) {
    return "Confirm details and send appointment reminder.";
  }
  const pol = (input.policyStatus ?? "").toLowerCase();
  if (pol.includes("pending") || pol.includes("uw") || pol.includes("underwriting")) {
    return "Complete underwriting checklist and follow up on requirements.";
  }
  const stage = (input.lifecycleStage ?? "").toLowerCase();
  if (stage.includes("follow")) {
    return "Execute follow-up cadence; log outcome after each touch.";
  }
  if (stage.includes("new") || stage.includes("attempt")) {
    return "Attempt contact; use script for first touch.";
  }
  const disp = (input.agentDisposition ?? "").toLowerCase();
  if (disp.includes("callback")) {
    return "Schedule callback and set reminder.";
  }
  if (disp.includes("dnc") || disp.includes("do not")) {
    return "Stop outreach; honor DNC.";
  }
  return "Review contact context and pick the next playbook step.";
}

export async function fetchAgentWorkspaceLeadQueue(args: {
  clientAccountId: string;
  subaccountIdGhl: string;
  lifecycleStages?: string[];
  assignedAgentId?: string;
  nicheKey?: string;
  limit: number;
}) {
  const stages =
    args.lifecycleStages && args.lifecycleStages.length > 0
      ? args.lifecycleStages
      : [...DEFAULT_LEAD_QUEUE_LIFECYCLE_STAGES];

  const stageFilters: Prisma.InboundContactIndexWhereInput[] = stages.flatMap((s) => {
    const t = s.trim();
    if (!t) {
      return [];
    }
    return [{ lifecycleStage: { equals: t, mode: "insensitive" } }];
  });

  const orStages =
    stageFilters.length > 0
      ? stageFilters
      : [{ lifecycleStage: { equals: "__none__", mode: "insensitive" as const } }];

  const andParts: Prisma.InboundContactIndexWhereInput[] = [{ OR: orStages }];

  if (args.assignedAgentId?.trim()) {
    andParts.push({ assignedAgentId: args.assignedAgentId.trim() });
  }
  if (args.nicheKey?.trim()) {
    andParts.push({
      leadType: { equals: args.nicheKey.trim(), mode: "insensitive" },
    });
  }

  const where: Prisma.InboundContactIndexWhereInput = {
    clientAccountId: args.clientAccountId,
    subaccountIdGhl: args.subaccountIdGhl,
    AND: andParts,
  };

  const rows = await prisma.inboundContactIndex.findMany({
    where,
    orderBy: [{ lastSeenAt: "desc" }, { updatedAt: "desc" }],
    take: args.limit,
  });

  const items = rows.map((row) => ({
    ...serializeInboundIndex(row),
    nextBestAction: deriveNextBestAction({
      lifecycleStage: row.lifecycleStage,
      appointmentStatus: row.appointmentStatus,
      policyStatus: row.policyStatus,
      agentDisposition: null,
    }),
  }));

  return {
    ok: true as const,
    clientAccountId: args.clientAccountId,
    subaccountIdGhl: args.subaccountIdGhl,
    defaultLifecycleStages: [...DEFAULT_LEAD_QUEUE_LIFECYCLE_STAGES],
    appliedLifecycleStages: stages,
    items,
  };
}

/** Exported for unit tests and documentation of guidance scoping rules. */
export function guidanceResourceScopeWhere(
  clientAccountId: string,
  nicheKey?: string,
  lifecycleStage?: string
): Prisma.GuidanceResourceWhereInput {
  const andParts: Prisma.GuidanceResourceWhereInput[] = [];

  if (nicheKey?.trim()) {
    const nk = nicheKey.trim();
    andParts.push({
      OR: [
        { nicheKey: null },
        { nicheKey: "" },
        { nicheKey: { equals: nk, mode: "insensitive" } },
      ],
    });
  }

  if (lifecycleStage?.trim()) {
    const ls = lifecycleStage.trim();
    andParts.push({
      OR: [
        { lifecycleStage: null },
        { lifecycleStage: "" },
        { lifecycleStage: { equals: ls, mode: "insensitive" } },
      ],
    });
  }

  return {
    isActive: true,
    OR: [{ clientAccountId: null }, { clientAccountId: clientAccountId }],
    ...(andParts.length ? { AND: andParts } : {}),
  };
}

/** Exported for unit tests and documentation of playbook scoping rules. */
export function playbookScopeWhere(
  clientAccountId: string,
  nicheKey?: string
): Prisma.ObjectionPlaybookWhereInput {
  const andParts: Prisma.ObjectionPlaybookWhereInput[] = [];

  if (nicheKey?.trim()) {
    const nk = nicheKey.trim();
    andParts.push({
      OR: [
        { nicheKey: null },
        { nicheKey: "" },
        { nicheKey: { equals: nk, mode: "insensitive" } },
      ],
    });
  }

  return {
    isActive: true,
    OR: [{ clientAccountId: null }, { clientAccountId: clientAccountId }],
    ...(andParts.length ? { AND: andParts } : {}),
  };
}

function serializeGuidanceResource(r: GuidanceResource) {
  return {
    id: r.id,
    clientAccountId: r.clientAccountId,
    nicheKey: r.nicheKey,
    lifecycleStage: r.lifecycleStage,
    resourceType: r.resourceType,
    title: r.title,
    slug: r.slug,
    body: r.body,
    tags: r.tags,
    isActive: r.isActive,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function serializePlaybook(p: ObjectionPlaybook) {
  return {
    id: p.id,
    clientAccountId: p.clientAccountId,
    nicheKey: p.nicheKey,
    objectionKey: p.objectionKey,
    title: p.title,
    recommendedResponse: p.recommendedResponse,
    followUpMessage: p.followUpMessage,
    nextBestAction: p.nextBestAction,
    isActive: p.isActive,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function fetchAgentWorkspaceGuidance(args: {
  clientAccountId: string;
  subaccountIdGhl: string;
  nicheKey?: string;
  lifecycleStage?: string;
}) {
  const resourceWhere = guidanceResourceScopeWhere(
    args.clientAccountId,
    args.nicheKey,
    args.lifecycleStage
  );

  const [scripts, referrals, policyReview, policyDelivery, otherResources, playbooks] =
    await Promise.all([
      prisma.guidanceResource.findMany({
        where: { ...resourceWhere, resourceType: GuidanceResourceType.SCRIPT },
        orderBy: [{ slug: "asc" }],
      }),
      prisma.guidanceResource.findMany({
        where: { ...resourceWhere, resourceType: GuidanceResourceType.REFERRAL },
        orderBy: [{ slug: "asc" }],
      }),
      prisma.guidanceResource.findMany({
        where: { ...resourceWhere, resourceType: GuidanceResourceType.POLICY_REVIEW },
        orderBy: [{ slug: "asc" }],
      }),
      prisma.guidanceResource.findMany({
        where: { ...resourceWhere, resourceType: GuidanceResourceType.POLICY_DELIVERY },
        orderBy: [{ slug: "asc" }],
      }),
      prisma.guidanceResource.findMany({
        where: {
          ...resourceWhere,
          resourceType: {
            in: [
              GuidanceResourceType.OBJECTION,
              GuidanceResourceType.FOLLOW_UP,
              GuidanceResourceType.UNDERWRITING,
              GuidanceResourceType.TRUST_BUILDER,
            ],
          },
        },
        orderBy: [{ resourceType: "asc" }, { slug: "asc" }],
      }),
      prisma.objectionPlaybook.findMany({
        where: playbookScopeWhere(args.clientAccountId, args.nicheKey),
        orderBy: [{ objectionKey: "asc" }],
      }),
    ]);

  const assignments = await prisma.clientScriptAssignment.findMany({
    where: {
      clientAccountId: args.clientAccountId,
      subaccountIdGhl: args.subaccountIdGhl,
      isActive: true,
      ...(args.nicheKey?.trim()
        ? {
            OR: [
              { nicheKey: null },
              { nicheKey: "" },
              { nicheKey: { equals: args.nicheKey.trim(), mode: "insensitive" } },
            ],
          }
        : {}),
    },
    orderBy: [{ sortOrder: "asc" }],
    include: { guidanceResource: true },
  });

  return {
    ok: true as const,
    clientAccountId: args.clientAccountId,
    subaccountIdGhl: args.subaccountIdGhl,
    scripts: scripts.map(serializeGuidanceResource),
    referralPrompts: referrals.map(serializeGuidanceResource),
    policyReviewPrompts: policyReview.map(serializeGuidanceResource),
    policyDeliveryPrompts: policyDelivery.map(serializeGuidanceResource),
    otherResources: otherResources.map(serializeGuidanceResource),
    objectionPlaybooks: playbooks.map(serializePlaybook),
    clientScriptAssignments: assignments.map((a) => ({
      id: a.id,
      sortOrder: a.sortOrder,
      nicheKey: a.nicheKey,
      resource: serializeGuidanceResource(a.guidanceResource),
    })),
  };
}

function recommendedNextAfterOutcome(outcome: WhatHappenedBody["outcome"]): string {
  switch (outcome) {
    case "appointment_set":
      return "Send confirmation and add calendar details to GHL when sync is enabled.";
    case "callback_scheduled":
      return "Log callback time in GHL and prepare follow-up script.";
    case "not_interested":
      return "Mark disposition; offer polite close and stop aggressive cadence.";
    case "no_answer":
      return "Retry per dialer policy; vary time windows.";
    case "connected_no_result":
      return "Schedule follow-up or send recap SMS/email per playbook.";
    case "sale_logged":
      return "Trigger policy delivery checklist and underwriting prompts.";
    case "wrong_number":
      return "Update contact record when GHL sync is enabled; remove bad number if appropriate.";
    case "other":
    default:
      return "Review lead queue and pick next contact.";
  }
}

export async function recordWhatHappened(body: WhatHappenedBody) {
  const sub = resolveWorkspaceSubaccountIdGhl({
    subaccountIdGhl: body.subaccountIdGhl,
    locationId: body.locationId,
  });
  const contactId = body.contactIdGhl?.trim() || undefined;
  const leadUid = body.leadUid?.trim() || undefined;

  if (!contactId && !leadUid) {
    return { ok: false as const, error: "contactIdGhl or leadUid is required" };
  }

  const payloadForStore = redactWebhookPayloadForLog({
    outcome: body.outcome,
    notes: body.notes,
    resourceId: body.resourceId,
    metadata: body.metadata,
    clientAccountId: body.clientAccountId,
    subaccountIdGhl: sub,
    contactIdGhl: contactId,
    leadUid,
  });

  const metaForEvent = redactWebhookPayloadForLog({
    outcome: body.outcome,
    notes: body.notes,
    resourceId: body.resourceId,
    metadata: body.metadata,
  });

  const [action, event] = await prisma.$transaction([
    prisma.agentWorkspaceAction.create({
      data: {
        clientAccountId: body.clientAccountId,
        subaccountIdGhl: sub || null,
        contactIdGhl: contactId ?? null,
        leadUid: leadUid ?? null,
        actionType: "what_happened",
        status: "PENDING",
        payloadJson: payloadForStore as Prisma.InputJsonValue,
        responseJson: { localRecorded: true, ghlSync: "pending" } as Prisma.InputJsonValue,
      },
    }),
    prisma.contactGuidanceEvent.create({
      data: {
        clientAccountId: body.clientAccountId,
        contactIdGhl: contactId ?? null,
        leadUid: leadUid ?? null,
        resourceId: body.resourceId?.trim() || null,
        actionType: "OUTCOME_LOGGED",
        metadata: metaForEvent as Prisma.InputJsonValue,
      },
    }),
  ]);

  const index = await loadInboundIndex({
    clientAccountId: body.clientAccountId,
    subaccountIdGhl: sub,
    contactIdGhl: contactId,
    leadUid,
  });

  const recommendedNextAction =
    index != null
      ? deriveNextBestAction({
          lifecycleStage: index.lifecycleStage,
          appointmentStatus: index.appointmentStatus,
          policyStatus: index.policyStatus,
          agentDisposition: null,
        })
      : recommendedNextAfterOutcome(body.outcome);

  const locationForGhl = sub.trim() || getGhlLocationId()?.trim() || "";
  const meta =
    body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? (body.metadata as Record<string, unknown>)
      : undefined;

  const ghlSync = await finalizeWhatHappenedGhlSync({
    actionId: action.id,
    clientAccountId: body.clientAccountId,
    locationId: locationForGhl,
    contactIdGhl: contactId ?? null,
    outcome: body.outcome,
    notes: body.notes,
    metadata: meta,
  });

  return {
    ok: true as const,
    agentWorkspaceActionId: action.id,
    contactGuidanceEventId: event.id,
    recommendedNextAction,
    /** LifecycleEvent rows are only created by GHL webhook ingest; workspace outcomes stay in AgentWorkspaceAction. */
    lifecycleEventCreated: false as const,
    ghlSync,
  };
}

export async function recordContactGuidanceEvent(body: ContactGuidanceEventBody) {
  const contactId = body.contactIdGhl?.trim() || undefined;
  const leadUid = body.leadUid?.trim() || undefined;
  if (!contactId && !leadUid) {
    return { ok: false as const, error: "contactIdGhl or leadUid is required" };
  }

  const meta = body.metadata
    ? (redactWebhookPayloadForLog(body.metadata) as Prisma.InputJsonValue)
    : undefined;

  const row = await prisma.contactGuidanceEvent.create({
    data: {
      clientAccountId: body.clientAccountId.trim(),
      contactIdGhl: contactId ?? null,
      leadUid: leadUid ?? null,
      resourceId: body.resourceId?.trim() || null,
      actionType: body.actionType,
      metadata: meta,
    },
  });

  return {
    ok: true as const,
    id: row.id,
  };
}

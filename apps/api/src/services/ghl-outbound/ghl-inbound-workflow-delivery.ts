import { Prisma } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { logger } from "../../lib/logger.js";

export const GHL_INBOUND_WEBHOOK_ADAPTER_KEY = "webhook.generic.v1";
export const GHL_INBOUND_WEBHOOK_FLAG = "SA360_GHL_INBOUND_WEBHOOK_ENABLED";
export const GHL_INBOUND_WEBHOOK_MODE = "ghl_inbound_webhook";

export function isGhlInboundWebhookEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return env[GHL_INBOUND_WEBHOOK_FLAG]?.trim().toLowerCase() === "true";
}

/** One delivery per source lead event. Contact email and phone are not part of the key. */
export function ghlInboundWebhookIdempotencyKey(
  clientAccountId: string,
  sourceLeadEventId: string
): string {
  return `ghl-webhook:${clientAccountId}:${sourceLeadEventId}`;
}

export type InboundWebhookRunStatus =
  | "pending"
  | "executing"
  | "succeeded"
  | "failed"
  | "unknown_outcome";

export type InboundWebhookRun = {
  id: string;
  status: InboundWebhookRunStatus;
  summary: string | null;
};

export type InboundWebhookTarget = {
  endpointUrl: string;
  campaignDispatchEnabled: boolean;
  campaignDispatchNotBefore: Date | null;
};

export type InboundWebhookDeliveryInput = {
  sourceLeadEventId: string;
  status: string;
  clientAccountId: string | null;
  resolvedAt: Date;
  payload: Record<string, unknown>;
};

export type InboundWebhookDeliveryResult = {
  outcome:
    | "disabled"
    | "not_matched"
    | "not_armed"
    | "before_cutoff"
    | "invalid_endpoint"
    | "duplicate"
    | "sent"
    | "rejected"
    | "rate_limited"
    | "unknown";
  externalCallExecuted: boolean;
};

type FinishStatus = "pending" | "succeeded" | "failed" | "unknown_outcome";

export type InboundWebhookDeps = {
  enabled: boolean;
  loadTarget: (clientAccountId: string) => Promise<InboundWebhookTarget | null>;
  findRun: (idempotencyKey: string) => Promise<InboundWebhookRun | null>;
  createPending: (input: {
    idempotencyKey: string;
    clientAccountId: string;
    sourceLeadEventId: string;
  }) => Promise<InboundWebhookRun | "conflict">;
  claim: (id: string) => Promise<boolean>;
  finish: (id: string, status: FinishStatus, summary: string) => Promise<void>;
  fetch: typeof fetch;
  timeoutMs?: number;
};

export function sendIsAllowed(run: InboundWebhookRun | null): boolean {
  return run == null || run.status === "pending";
}

/** 2xx succeeded. 429 was refused. Other 4xx was seen and refused. Timeout and 5xx stay unknown. */
export function classifyInboundWebhookStatus(
  status: number
): "succeeded" | "rejected" | "rate_limited" | "unknown" {
  if (status >= 200 && status < 300) return "succeeded";
  if (status === 429) return "rate_limited";
  if (status >= 400 && status < 500 && status !== 408 && status !== 409) return "rejected";
  return "unknown";
}

export function isSafeInboundWebhookUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.username === "" && url.password === "" && url.hostname !== "";
  } catch {
    return false;
  }
}

function blank(value: string | null | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function buildGhlInboundWorkflowPayload(input: {
  sourceLeadEventId: string;
  clientAccountId: string;
  receivedAt: string;
  contact?: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
  } | null;
  campaignId?: string | null;
}): Record<string, unknown> {
  return {
    sourceLeadEventId: input.sourceLeadEventId,
    clientAccountId: input.clientAccountId,
    receivedAt: input.receivedAt,
    campaignId: blank(input.campaignId),
    contact: {
      firstName: blank(input.contact?.firstName),
      lastName: blank(input.contact?.lastName),
      email: blank(input.contact?.email),
      phone: blank(input.contact?.phone),
    },
  };
}

function stopped(outcome: InboundWebhookDeliveryResult["outcome"]): InboundWebhookDeliveryResult {
  return { outcome, externalCallExecuted: false };
}

/**
 * Posts one lead event to a client GHL inbound-workflow webhook.
 * A second source event is a second post even when the contact is the same.
 * A timeout or 5xx is not posted again.
 */
export async function deliverGhlInboundWebhook(
  input: InboundWebhookDeliveryInput,
  deps: InboundWebhookDeps
): Promise<InboundWebhookDeliveryResult> {
  if (!deps.enabled) return stopped("disabled");
  if (input.status !== "routing_matched") return stopped("not_matched");
  const clientAccountId = input.clientAccountId?.trim() ?? "";
  const sourceLeadEventId = input.sourceLeadEventId.trim();
  if (!clientAccountId || !sourceLeadEventId) return stopped("not_matched");

  const target = await deps.loadTarget(clientAccountId);
  if (!target?.campaignDispatchEnabled || !target.campaignDispatchNotBefore) {
    return stopped("not_armed");
  }
  if (input.resolvedAt < target.campaignDispatchNotBefore) return stopped("before_cutoff");
  if (!isSafeInboundWebhookUrl(target.endpointUrl)) return stopped("invalid_endpoint");

  const idempotencyKey = ghlInboundWebhookIdempotencyKey(clientAccountId, sourceLeadEventId);
  let run = await deps.findRun(idempotencyKey);
  if (!sendIsAllowed(run)) return stopped("duplicate");
  if (!run) {
    const created = await deps.createPending({ idempotencyKey, clientAccountId, sourceLeadEventId });
    if (created === "conflict") {
      run = await deps.findRun(idempotencyKey);
      if (!sendIsAllowed(run) || !run) return stopped("duplicate");
    } else {
      run = created;
    }
  }

  const claimed = await deps.claim(run.id);
  if (!claimed) return stopped("duplicate");

  let status = 0;
  let transportFailed = false;
  try {
    const response = await deps.fetch(target.endpointUrl, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify(input.payload),
      signal: AbortSignal.timeout(deps.timeoutMs ?? 8000),
      redirect: "error",
    });
    status = response.status;
  } catch {
    transportFailed = true;
  }

  const classification = transportFailed ? "unknown" : classifyInboundWebhookStatus(status);
  if (classification === "succeeded") {
    await deps.finish(run.id, "succeeded", "sent");
    return { outcome: "sent", externalCallExecuted: true };
  }
  if (classification === "rejected") {
    await deps.finish(run.id, "failed", "rejected");
    return { outcome: "rejected", externalCallExecuted: true };
  }
  if (classification === "rate_limited") {
    await deps.finish(run.id, "pending", "rate_limited_not_sent");
    return { outcome: "rate_limited", externalCallExecuted: false };
  }
  await deps.finish(run.id, "unknown_outcome", "outcome_unknown");
  return { outcome: "unknown", externalCallExecuted: true };
}

function readTarget(config: unknown): InboundWebhookTarget | null {
  if (!config || typeof config !== "object" || Array.isArray(config)) return null;
  const record = config as Record<string, unknown>;
  const endpointUrl = typeof record.endpointUrl === "string" ? record.endpointUrl.trim() : "";
  const cutoffRaw =
    typeof record.campaignDispatchNotBefore === "string" ? record.campaignDispatchNotBefore : null;
  const cutoff = cutoffRaw ? new Date(cutoffRaw) : null;
  if (cutoff && Number.isNaN(cutoff.getTime())) return null;
  return {
    endpointUrl,
    campaignDispatchEnabled: record.campaignDispatchEnabled === true,
    campaignDispatchNotBefore: cutoff,
  };
}

function isUniqueConflict(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}

export async function deliverGhlInboundWebhookFromIntake(
  input: InboundWebhookDeliveryInput,
  env: NodeJS.ProcessEnv = process.env
): Promise<InboundWebhookDeliveryResult> {
  if (!isGhlInboundWebhookEnabled(env)) return stopped("disabled");
  try {
    return await deliverGhlInboundWebhook(input, {
      enabled: true,
      loadTarget: async (clientAccountId) => {
        const primary = await prisma.deliveryTarget.findFirst({
          where: {
            clientAccountId,
            adapterKey: GHL_INBOUND_WEBHOOK_ADAPTER_KEY,
            enabled: true,
            isPrimary: true,
          },
        });
        const row =
          primary ??
          (await prisma.deliveryTarget.findMany({
            where: { clientAccountId, adapterKey: GHL_INBOUND_WEBHOOK_ADAPTER_KEY, enabled: true },
            take: 2,
          }).then((rows) => (rows.length === 1 ? rows[0] : null)));
        return row ? readTarget(row.configMetadataJson) : null;
      },
      findRun: async (idempotencyKey) => {
        const row = await prisma.ghlLiveDeliveryRun.findUnique({ where: { idempotencyKey } });
        if (!row) return null;
        return { id: row.id, status: row.status as InboundWebhookRunStatus, summary: row.summary };
      },
      createPending: async ({ idempotencyKey, clientAccountId, sourceLeadEventId }) => {
        try {
          return await prisma.$transaction(async (tx) => {
            const plan = await tx.leadDeliveryPlan.create({
              data: {
                masterClientAccountId: clientAccountId,
                destinationClientAccountId: clientAccountId,
                deliveryMode: GHL_INBOUND_WEBHOOK_MODE,
                status: "recorded",
                generatedBy: "sa360_ghl_inbound_webhook",
                summary: sourceLeadEventId,
              },
            });
            const run = await tx.ghlLiveDeliveryRun.create({
              data: {
                leadDeliveryPlan: { connect: { id: plan.id } },
                masterClientAccountId: clientAccountId,
                destinationClientAccountId: clientAccountId,
                mode: GHL_INBOUND_WEBHOOK_MODE,
                status: "pending",
                idempotencyKey,
                summary: "not_sent",
              },
            });
            return { id: run.id, status: "pending" as const, summary: run.summary };
          });
        } catch (err) {
          if (isUniqueConflict(err)) return "conflict" as const;
          throw err;
        }
      },
      claim: async (id) => {
        const claimed = await prisma.ghlLiveDeliveryRun.updateMany({
          where: { id, status: "pending" },
          data: { status: "executing" },
        });
        return claimed.count === 1;
      },
      finish: async (id, status, summary) => {
        const terminal = status !== "pending";
        await prisma.ghlLiveDeliveryRun.update({
          where: { id },
          data: {
            status,
            summary,
            completedAt: terminal ? new Date() : null,
            errors: terminal && status !== "succeeded" ? [summary] : [],
          },
        });
      },
      fetch,
    });
  } catch (err) {
    logger.warn("ghl_inbound_webhook.unexpected", {
      sourceLeadEventId: input.sourceLeadEventId,
      message: err instanceof Error ? err.name : "error",
    });
    return stopped("unknown");
  }
}

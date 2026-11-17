/**
 * Operator configuration for SourceFunnel.leadTypeKey.
 *
 * Omitted input preserves the stored key. A change writes only that column
 * and an append-only audit of who changed it. Origin, suggestion, inventory,
 * and historical source events stay untouched.
 */

import type { PrismaClient, SourceFunnel } from "@prisma/client";
import { isCampaignLeadTypeKey, type CampaignLeadTypeKey } from "@sa360/shared";

import { prisma } from "../../lib/db.js";
import { acceptedOnboardingActor } from "../../lib/onboarding-staff-actor.js";
import { findSourceFunnelById } from "../../repositories/source-funnel.repository.js";

export type SourceFunnelLeadTypeErrorCode =
  | "source_funnel_not_found"
  | "invalid_lead_type_key"
  | "actor_rejected";

export class SourceFunnelLeadTypeError extends Error {
  readonly code: SourceFunnelLeadTypeErrorCode;

  constructor(code: SourceFunnelLeadTypeErrorCode) {
    super(code);
    this.name = "SourceFunnelLeadTypeError";
    this.code = code;
  }
}

export function isSourceFunnelLeadTypeError(err: unknown): err is SourceFunnelLeadTypeError {
  return err instanceof SourceFunnelLeadTypeError;
}

export type ConfigureSourceFunnelLeadTypeResult = {
  sourceFunnel: SourceFunnel;
  changed: boolean;
};

/**
 * `leadTypeKey` omitted (`undefined`) preserves the current value.
 * `null` clears it. Any other string must be a controlled key.
 */
export async function configureSourceFunnelLeadType(
  input: {
    sourceFunnelId: string;
    leadTypeKey?: string | null;
    actor: string;
  },
  db: PrismaClient = prisma
): Promise<ConfigureSourceFunnelLeadTypeResult> {
  const actor = acceptedOnboardingActor(input.actor);
  if (!actor) throw new SourceFunnelLeadTypeError("actor_rejected");

  const sourceFunnelId = input.sourceFunnelId.trim();
  const current = await findSourceFunnelById(sourceFunnelId, db);
  if (!current) throw new SourceFunnelLeadTypeError("source_funnel_not_found");
  if (input.leadTypeKey === undefined) return { sourceFunnel: current, changed: false };

  const next = normalizeNextKey(input.leadTypeKey);
  if (current.leadTypeKey === next) return { sourceFunnel: current, changed: false };

  const sourceFunnel = await db.$transaction(async (tx) => {
    const locked = await tx.sourceFunnel.findUnique({ where: { id: current.id } });
    if (!locked) throw new SourceFunnelLeadTypeError("source_funnel_not_found");
    if (locked.leadTypeKey === next) return locked;
    const updated = await tx.sourceFunnel.update({
      where: { id: locked.id },
      data: { leadTypeKey: next },
    });
    await tx.sourceFunnelLeadTypeAudit.create({
      data: {
        sourceFunnelId: locked.id,
        previousKey: locked.leadTypeKey,
        nextKey: next,
        actor,
      },
    });
    return updated;
  });
  return { sourceFunnel, changed: sourceFunnel.leadTypeKey !== current.leadTypeKey };
}

function normalizeNextKey(raw: string | null): CampaignLeadTypeKey | null {
  if (raw === null) return null;
  const key = raw.trim();
  if (!isCampaignLeadTypeKey(key)) throw new SourceFunnelLeadTypeError("invalid_lead_type_key");
  return key;
}

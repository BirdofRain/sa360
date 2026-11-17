/**
 * Operator configuration for SourceFunnel.leadTypeKey.
 *
 * Omitted input preserves the stored key. A change writes only that column
 * and an append-only audit of who changed it. Origin, suggestion, inventory,
 * and historical source events stay untouched.
 */

import type { Prisma, PrismaClient, SourceFunnel } from "@prisma/client";
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
  if (input.leadTypeKey === undefined) {
    const current = await findSourceFunnelById(sourceFunnelId, db);
    if (!current) throw new SourceFunnelLeadTypeError("source_funnel_not_found");
    return { sourceFunnel: current, changed: false };
  }

  const next = normalizeNextKey(input.leadTypeKey);
  return db.$transaction(async (tx) => {
    const lockedId = await lockSourceFunnelId(tx, sourceFunnelId);
    if (!lockedId) throw new SourceFunnelLeadTypeError("source_funnel_not_found");
    const locked = await tx.sourceFunnel.findUnique({ where: { id: lockedId } });
    if (!locked) throw new SourceFunnelLeadTypeError("source_funnel_not_found");
    if (locked.leadTypeKey === next) return { sourceFunnel: locked, changed: false };
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
    return { sourceFunnel: updated, changed: true };
  });
}

/** Serialize Lead Type writes so the audit previous value is the locked row. */
async function lockSourceFunnelId(
  tx: Prisma.TransactionClient,
  sourceFunnelId: string
): Promise<string | null> {
  const rows = await tx.$queryRaw<Array<{ id: string }>>`
    SELECT id FROM "SourceFunnel" WHERE id = ${sourceFunnelId} FOR UPDATE
  `;
  return rows[0]?.id ?? null;
}

function normalizeNextKey(raw: string | null): CampaignLeadTypeKey | null {
  if (raw === null) return null;
  const key = raw.trim();
  if (!isCampaignLeadTypeKey(key)) throw new SourceFunnelLeadTypeError("invalid_lead_type_key");
  return key;
}

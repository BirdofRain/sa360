import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

/**
 * Latest lifecycle row for a GHL contact, preferring the same `clientAccountId` as the index row.
 */
export async function findLatestLifecyclePayloadJsonForContact(args: {
  contactIdGhl: string;
  clientAccountId: string;
}): Promise<unknown | null> {
  const cid = args.contactIdGhl.trim();
  if (!cid) {
    return null;
  }
  const ca = args.clientAccountId.trim();

  const scopedWhere: Prisma.LifecycleEventWhereInput = ca
    ? { contactIdGhl: cid, clientAccountId: ca }
    : { contactIdGhl: cid };

  const scoped = await prisma.lifecycleEvent.findFirst({
    where: scopedWhere,
    orderBy: { receivedAt: "desc" },
    select: { payloadJson: true },
  });
  if (scoped?.payloadJson != null) {
    return scoped.payloadJson;
  }

  if (!ca) {
    return null;
  }

  const anyClient = await prisma.lifecycleEvent.findFirst({
    where: { contactIdGhl: cid },
    orderBy: { receivedAt: "desc" },
    select: { payloadJson: true },
  });
  return anyClient?.payloadJson ?? null;
}

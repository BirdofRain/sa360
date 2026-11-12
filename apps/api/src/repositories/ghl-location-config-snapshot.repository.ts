import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { isUsableGhlLocationConfigSnapshot } from "../lib/ghl-config-snapshot-validity.js";

const USABLE_SNAPSHOT_PAGE = 25;

/**
 * Serializes a discovery insert with an operational save for one location.
 * Both `createGhlLocationConfigSnapshot` and operational authorization take
 * this transaction-scoped lock before they read or insert the newest row.
 */
export function ghlLocationSnapshotLockKey(locationId: string): string {
  return `ghl-location-snapshot:${locationId.trim()}`;
}

export async function lockGhlLocationSnapshot(
  tx: Prisma.TransactionClient,
  locationId: string
): Promise<void> {
  await tx.$executeRaw`SELECT set_config('lock_timeout', '3s', true)`;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${ghlLocationSnapshotLockKey(locationId)}))`;
}

/**
 * Chronological newest snapshot for one location, including a failed refresh
 * kept for audit. Discovery load uses it to see whether a newer row failed.
 * Operational authorization reads this same ordering inside its transaction
 * and rejects the row when the discovery is incomplete.
 */
export async function findNewestGhlLocationConfigSnapshot(locationId: string) {
  return prisma.ghlLocationConfigSnapshot.findFirst({
    where: { locationId: locationId.trim() },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
  });
}

/**
 * Chronological newest row, including a failed audit row.
 * Operational saves, canary preflight, and channel readiness do not use this
 * as authorization. They classify the newest row and fail closed.
 */
export async function findLatestGhlLocationConfigSnapshot(locationId: string) {
  return prisma.ghlLocationConfigSnapshot.findFirst({
    where: { locationId: locationId.trim() },
    orderBy: { fetchedAt: "desc" },
  });
}

/**
 * Newest complete discovery for this location. Failed and incomplete refreshes
 * remain stored and are skipped. Another location's rows are never selected.
 */
export async function findLatestUsableGhlLocationConfigSnapshot(locationId: string) {
  const trimmed = locationId.trim();
  let skip = 0;
  for (;;) {
    const rows = await prisma.ghlLocationConfigSnapshot.findMany({
      where: { locationId: trimmed },
      orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
      skip,
      take: USABLE_SNAPSHOT_PAGE,
    });
    const usable = rows.find((row) => isUsableGhlLocationConfigSnapshot(row));
    if (usable) return usable;
    if (rows.length < USABLE_SNAPSHOT_PAGE) return null;
    skip += rows.length;
  }
}

export async function createGhlLocationConfigSnapshot(
  data: Prisma.GhlLocationConfigSnapshotCreateInput
) {
  const locationId = typeof data.locationId === "string" ? data.locationId.trim() : "";
  return prisma.$transaction(async (tx) => {
    if (locationId) await lockGhlLocationSnapshot(tx, locationId);
    return tx.ghlLocationConfigSnapshot.create({ data });
  }, { timeout: 15_000 });
}

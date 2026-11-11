import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";
import { isUsableGhlLocationConfigSnapshot } from "../lib/ghl-config-snapshot-validity.js";

const USABLE_SNAPSHOT_PAGE = 25;

/**
 * Chronological newest snapshot for one location, including a failed refresh
 * kept for audit. Discovery load uses it to see whether a newer row failed.
 * Configuration-request verification reads that newest row and rejects it
 * when the discovery is incomplete.
 */
export async function findNewestGhlLocationConfigSnapshot(locationId: string) {
  return prisma.ghlLocationConfigSnapshot.findFirst({
    where: { locationId: locationId.trim() },
    orderBy: [{ fetchedAt: "desc" }, { id: "desc" }],
  });
}

/** Chronological newest row. Unchanged for operational snapshot readers. */
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
  return prisma.ghlLocationConfigSnapshot.create({ data });
}

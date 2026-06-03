import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/db.js";

export async function findLatestGhlLocationConfigSnapshot(locationId: string) {
  return prisma.ghlLocationConfigSnapshot.findFirst({
    where: { locationId: locationId.trim() },
    orderBy: { fetchedAt: "desc" },
  });
}

export async function createGhlLocationConfigSnapshot(
  data: Prisma.GhlLocationConfigSnapshotCreateInput
) {
  return prisma.ghlLocationConfigSnapshot.create({ data });
}

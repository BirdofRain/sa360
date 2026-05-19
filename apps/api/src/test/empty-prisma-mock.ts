import type { PrismaClient } from "@prisma/client";

/** In-memory Prisma stub for route/service tests (no DATABASE_URL required). */
export function createEmptyPrismaMock(): PrismaClient {
  const nullFirst = async () => null;
  const emptyMany = async () => [];
  return {
    clientConfig: { findUnique: nullFirst },
    inboundContactIndex: { findMany: emptyMany, findFirst: nullFirst },
    lifecycleEvent: { findMany: emptyMany, findFirst: nullFirst },
    synthflowRequestLog: { findMany: emptyMany, findFirst: nullFirst },
    synthflowOutboundResultLog: { findMany: emptyMany, findFirst: nullFirst },
    webhookRequestLog: { findFirst: nullFirst },
  } as unknown as PrismaClient;
}

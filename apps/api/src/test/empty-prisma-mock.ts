import type { PrismaClient } from "@prisma/client";

/** In-memory Prisma stub for route/service tests (no DATABASE_URL required). */
export function createEmptyPrismaMock(): PrismaClient {
  const nullFirst = async () => null;
  const emptyMany = async () => [];
  const zero = async () => 0;
  return {
    clientConfig: { findUnique: nullFirst },
    leadAttribution: { findMany: emptyMany },
    inboundContactIndex: { findMany: emptyMany, findFirst: nullFirst },
    lifecycleEvent: {
      findMany: emptyMany,
      findFirst: nullFirst,
      count: zero,
    },
    synthflowRequestLog: { findMany: emptyMany, findFirst: nullFirst, count: zero },
    synthflowOutboundResultLog: {
      findMany: emptyMany,
      findFirst: nullFirst,
      count: zero,
    },
    webhookRequestLog: { findFirst: nullFirst, count: zero },
    campaignRoutingRule: { findMany: emptyMany, create: nullFirst },
    routingDryRunDecision: { findMany: emptyMany, create: nullFirst },
    clientAccount: { findUnique: nullFirst, findFirst: nullFirst },
  } as unknown as PrismaClient;
}

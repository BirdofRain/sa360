/**
 * Every delivery-diagnostics query runs inside one PostgreSQL transaction
 * that the server itself marks read-only. A write, a DDL statement, or a
 * `SELECT ... FOR UPDATE` raises on the server, so the guarantee does not
 * rest on application code alone.
 *
 * The statement and lock timeouts are `SET LOCAL`: they end with the
 * transaction and never alter a pooled connection for other callers.
 */

import type { Prisma, PrismaClient } from "@prisma/client";

export const DIAGNOSTICS_STATEMENT_TIMEOUT_MS = 8_000;
export const DIAGNOSTICS_LOCK_TIMEOUT_MS = 1_000;
export const DIAGNOSTICS_TRANSACTION_TIMEOUT_MS = 25_000;
export const DIAGNOSTICS_TRANSACTION_MAX_WAIT_MS = 3_000;

export type DiagnosticsDb = Prisma.TransactionClient;

export async function withReadOnlyDb<T>(
  db: Pick<PrismaClient, "$transaction">,
  work: (tx: DiagnosticsDb) => Promise<T>
): Promise<T> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SET TRANSACTION READ ONLY`;
      await tx.$executeRaw`SET LOCAL statement_timeout = 8000`;
      await tx.$executeRaw`SET LOCAL lock_timeout = 1000`;
      await tx.$executeRaw`SET LOCAL idle_in_transaction_session_timeout = 30000`;
      return work(tx);
    },
    {
      isolationLevel: "RepeatableRead",
      maxWait: DIAGNOSTICS_TRANSACTION_MAX_WAIT_MS,
      timeout: DIAGNOSTICS_TRANSACTION_TIMEOUT_MS,
    }
  );
}

/** Rejects after `ms` and never leaves a timer running once `work` settles. */
export async function withDeadline<T>(work: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label}_timeout`)), ms);
    timer.unref?.();
  });
  try {
    return await Promise.race([work, deadline]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

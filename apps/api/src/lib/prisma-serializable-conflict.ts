import { Prisma } from "@prisma/client";

/**
 * Detect PostgreSQL/Prisma serializable or deadlock contention without exposing
 * raw SQLSTATE codes, driver messages, or Prisma internals to API callers.
 *
 * Callers should map a positive result to a typed domain code such as
 * `reservation_conflict` / `shortage` with a domain reason like
 * `inventory_changed_retry`.
 */
function messageIndicatesSerializableConflict(message: string): boolean {
  // Match driver/SQLSTATE signals only for classification; never forward message.
  if (/\bP2034\b/.test(message) || /\bP2002\b/.test(message)) return true;
  if (/\b40001\b/.test(message) || /\b40P01\b/.test(message)) return true;
  if (/could not serialize access/i.test(message)) return true;
  if (/deadlock detected/i.test(message)) return true;
  return false;
}

export function isPrismaSerializableConflict(err: unknown): boolean {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    // P2034: write conflict / deadlock retry; P2002 can race under serializable
    // uniqueness contention during concurrent allocation attempts.
    if (err.code === "P2034" || err.code === "P2002") return true;
    // Raw query failures (often P2010) wrap PostgreSQL SQLSTATE in the message.
    return messageIndicatesSerializableConflict(err.message);
  }

  if (!(err instanceof Error)) return false;
  return messageIndicatesSerializableConflict(err.message);
}

/** Domain reason for contention after safe classification (never includes SQL text). */
export const INVENTORY_CHANGED_RETRY_REASON = "inventory_changed_retry" as const;

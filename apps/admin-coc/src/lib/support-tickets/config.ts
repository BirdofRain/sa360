/**
 * Feature flag for Admin C.O.C. support ticketing.
 * Roll back instantly: unset NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED or set to "false".
 */

const TRUTHY = new Set(["1", "true", "yes", "on"]);

export function isSupportTicketsEnabled(): boolean {
  const raw = process.env.NEXT_PUBLIC_SA360_SUPPORT_TICKETS_ENABLED?.trim().toLowerCase();
  if (!raw) return false;
  return TRUTHY.has(raw);
}

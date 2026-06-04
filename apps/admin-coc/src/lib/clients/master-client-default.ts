/**
 * Optional default master client account for admin filter forms (env-driven, not tenant-hardcoded).
 * Prefer `NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID`; legacy alias supported.
 */
export function getDefaultMasterClientAccountId(): string {
  return (
    process.env.NEXT_PUBLIC_SA360_DEFAULT_MASTER_CLIENT_ACCOUNT_ID?.trim() ||
    process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID?.trim() ||
    ""
  );
}

/** Suggested master account for new routing rules (from env — not hardcoded to a tenant). */
export function getDefaultMasterClientAccountId(): string {
  return process.env.NEXT_PUBLIC_ROUTING_DRY_RUN_MASTER_CLIENT_ACCOUNT_ID?.trim() ?? "";
}

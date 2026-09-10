/**
 * P2 origin-client exclusion: a confirmed origin ClientAccount must not buy
 * inventory originally generated for itself. Null origin stays eligible.
 * Suggestions do not count — only a persisted originClientAccountId stamp.
 */
export function isOriginClientBuyerIneligible(
  originClientAccountId: string | null | undefined,
  buyerClientAccountId: string
): boolean {
  const origin = originClientAccountId?.trim() || "";
  const buyer = buyerClientAccountId.trim();
  if (!origin || !buyer) return false;
  return origin === buyer;
}

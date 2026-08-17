/**
 * For priced Client Lead Orders, LeadOrderLine.requestedQuantity is authoritative.
 * Request-body quantity may not silently change the commercial contract.
 */
export function resolveAuthoritativeRequestedQuantity(input: {
  requestQuantity?: number;
  pricedRequestedQuantity: number | null;
  orderRequestedQuantity: number | null;
  orderLeadVolume: number | null;
}):
  | { ok: true; requestedQuantity: number; source: "priced_line" | "legacy_order" }
  | {
      ok: false;
      code: "priced_quantity_mismatch";
      reasons: string[];
      requestedQuantity: number;
    } {
  const fallback =
    input.pricedRequestedQuantity ??
    input.orderRequestedQuantity ??
    input.orderLeadVolume;

  if (input.pricedRequestedQuantity != null) {
    if (
      input.requestQuantity != null &&
      input.requestQuantity !== input.pricedRequestedQuantity
    ) {
      return {
        ok: false,
        code: "priced_quantity_mismatch",
        reasons: [
          "selection_quantity_must_match_priced_order_line",
          `order_quantity:${input.pricedRequestedQuantity}`,
          `request_quantity:${input.requestQuantity}`,
        ],
        requestedQuantity: input.pricedRequestedQuantity,
      };
    }
    return {
      ok: true,
      requestedQuantity: input.pricedRequestedQuantity,
      source: "priced_line",
    };
  }

  return {
    ok: true,
    requestedQuantity: input.requestQuantity ?? fallback ?? 0,
    source: "legacy_order",
  };
}

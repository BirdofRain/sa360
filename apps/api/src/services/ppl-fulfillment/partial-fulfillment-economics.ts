/**
 * Operational reconciliation only — no automatic refunds, discounts, or charges.
 */

export type PartialFulfillmentEconomics = {
  requestedQuantity: number;
  selectedQuantity: number;
  shortfallQuantity: number;
  unitPriceCents: number;
  requestedOrderValueCents: number;
  deliveredValueCents: number;
  potentialCreditCents: number | null;
  creditStatus: "confirmed_shortfall" | "search_incomplete" | "exact_fill";
  label: string;
};

export function computePartialFulfillmentEconomics(input: {
  requestedQuantity: number;
  selectedQuantity: number;
  unitPriceCents: number;
  scanLimitReached?: boolean;
}): PartialFulfillmentEconomics {
  const requestedQuantity = Math.max(0, Math.floor(input.requestedQuantity));
  const selectedQuantity = Math.max(0, Math.floor(input.selectedQuantity));
  const shortfallQuantity = Math.max(0, requestedQuantity - selectedQuantity);
  const unitPriceCents = Math.max(0, Math.floor(input.unitPriceCents));
  const requestedOrderValueCents = requestedQuantity * unitPriceCents;
  const deliveredValueCents = selectedQuantity * unitPriceCents;

  if (input.scanLimitReached) {
    return {
      requestedQuantity,
      selectedQuantity,
      shortfallQuantity,
      unitPriceCents,
      requestedOrderValueCents,
      deliveredValueCents,
      potentialCreditCents: null,
      creditStatus: "search_incomplete",
      label: "Search incomplete — credit not confirmed",
    };
  }

  if (shortfallQuantity === 0) {
    return {
      requestedQuantity,
      selectedQuantity,
      shortfallQuantity: 0,
      unitPriceCents,
      requestedOrderValueCents,
      deliveredValueCents,
      potentialCreditCents: 0,
      creditStatus: "exact_fill",
      label: "Exact fill",
    };
  }

  return {
    requestedQuantity,
    selectedQuantity,
    shortfallQuantity,
    unitPriceCents,
    requestedOrderValueCents,
    deliveredValueCents,
    potentialCreditCents: shortfallQuantity * unitPriceCents,
    creditStatus: "confirmed_shortfall",
    label: "Potential refund/credit (manual ops only)",
  };
}

export function formatUsdFromCents(cents: number): string {
  return `$${(cents / 100).toFixed(cents % 100 === 0 ? 0 : 2)}`;
}

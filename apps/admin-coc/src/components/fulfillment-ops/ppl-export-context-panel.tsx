import { authoritativeOrderQuantity } from "@/lib/fulfillment-ops/existing-order-context";
import { formatUsdFromCents } from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import type { FulfillmentOpsOrder } from "@/lib/fulfillment-ops/types";

export type PplExportContextPanelProps = {
  order: FulfillmentOpsOrder;
  selectedQuantity?: number | null;
  exportRowCount?: number | null;
  shortfallQuantity?: number | null;
  deliveredValueCents?: number | null;
  potentialCreditCents?: number | null;
  creditConfirmed?: boolean;
};

export function PplExportContextPanel({
  order,
  selectedQuantity,
  exportRowCount,
  shortfallQuantity,
  deliveredValueCents,
  potentialCreditCents,
  creditConfirmed = false,
}: PplExportContextPanelProps) {
  const pricing = order.pricing;
  const unitPrice = pricing?.unitPriceCents;
  const requestedQty = authoritativeOrderQuantity(order);
  const states = order.states.join(", ") || "—";
  const bucket = pricing?.label ?? pricing?.commerceAgeBucketKey ?? "—";
  const exportQty = exportRowCount ?? selectedQuantity ?? null;
  const isPartial = (shortfallQuantity ?? 0) > 0;
  const client = order.clientDisplayName?.trim() || order.clientAccountId;

  return (
    <div
      data-testid="ppl-export-context"
      className="rounded-lg border border-sky-200 bg-sky-50/80 p-4"
    >
      <div className="text-base font-semibold text-slate-900">
        Export for {client} · {order.orderNumber}
      </div>
      <div className="mt-1 text-sm text-slate-700">
        {order.nicheKey} · {states} · {bucket}
        {unitPrice != null ? ` · ${formatUsdFromCents(unitPrice)}/lead` : ""} · {requestedQty}{" "}
        {requestedQty === 1 ? "lead" : "leads"}
      </div>
      <dl className="mt-3 grid gap-2 text-sm md:grid-cols-4">
        <div>
          <dt className="text-slate-500">Client</dt>
          <dd className="font-medium">{client}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Order</dt>
          <dd className="font-mono font-medium">{order.orderNumber}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Niche / states</dt>
          <dd className="font-medium">
            {order.nicheKey} / {states}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Commerce bucket</dt>
          <dd className="font-medium">{bucket}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Unit price</dt>
          <dd className="font-medium">
            {unitPrice != null ? formatUsdFromCents(unitPrice) : "—"}
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Requested quantity</dt>
          <dd className="font-medium">{requestedQty}</dd>
        </div>
        <div>
          <dt className="text-slate-500">Selected / export rows</dt>
          <dd className="font-medium">{exportQty ?? "—"}</dd>
        </div>
        {isPartial ? (
          <div>
            <dt className="text-slate-500">Shortfall</dt>
            <dd className="font-medium">{shortfallQuantity}</dd>
          </div>
        ) : null}
        {isPartial && deliveredValueCents != null ? (
          <div>
            <dt className="text-slate-500">Delivered value</dt>
            <dd className="font-medium">{formatUsdFromCents(deliveredValueCents)}</dd>
          </div>
        ) : null}
        {isPartial && creditConfirmed && potentialCreditCents != null ? (
          <div>
            <dt className="text-slate-500">Potential credit</dt>
            <dd className="font-medium">{formatUsdFromCents(potentialCreditCents)}</dd>
          </div>
        ) : null}
      </dl>
    </div>
  );
}

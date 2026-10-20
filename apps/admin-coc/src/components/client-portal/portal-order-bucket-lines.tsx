"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  formatPortalBuyerEstimate,
  type PortalBuyerBucketEstimate,
  type PortalLineEstimateRow,
} from "@/lib/client-portal/portal-live-order";
import { portalAgedBucketOptions } from "@/lib/client-portal/portal-aged-order-options";

export function PortalOrderBucketLines({
  quantities,
  inspectAgeBucket,
  estimates,
  rows,
  evaluatedAt,
  availabilityNote,
  adjustmentLabels,
  acknowledged,
  onToggle,
  onQuantity,
  onInspect,
  onAcknowledge,
}: {
  quantities: Record<string, number>;
  inspectAgeBucket: string | null;
  estimates: Record<string, PortalBuyerBucketEstimate>;
  rows: PortalLineEstimateRow[];
  evaluatedAt: string | null;
  availabilityNote: string | null;
  adjustmentLabels: string[];
  acknowledged: boolean;
  onToggle: (bucket: string, selected: boolean) => void;
  onQuantity: (bucket: string, quantity: number) => void;
  onInspect: (bucket: string) => void;
  onAcknowledge: (checked: boolean) => void;
}) {
  const estimateByBucket = new Map(rows.map((row) => [row.commerceAgeBucketKey, row]));
  return (
    <fieldset className="grid min-w-0 gap-3 sm:col-span-2" data-testid="portal-order-bucket-lines">
      <legend className="text-sm font-medium text-slate-900">Age buckets</legend>
      <p className="text-xs text-slate-500">
        Select one or more age buckets. Each bucket keeps its own quantity. Availability is an
        estimate for this check and does not reserve inventory.
      </p>
      {portalAgedBucketOptions().map((option) => {
        const selected = Object.prototype.hasOwnProperty.call(quantities, option.value);
        const estimate = estimates[option.value];
        const priced = estimateByBucket.get(option.value);
        const quantityId = `order-line-qty-${option.value}`;
        return (
          <div
            key={option.value}
            className="grid gap-2 rounded-xl border border-slate-200 bg-white p-3 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]"
          >
            <div className="min-w-0 space-y-2">
              <label className="flex min-h-10 items-start gap-2 text-sm text-slate-900">
                <input
                  type="checkbox"
                  className="mt-1"
                  checked={selected}
                  aria-label={option.label}
                  onChange={(event) => onToggle(option.value, event.target.checked)}
                />
                <span>
                  <span className="font-medium">{option.label}</span>
                  <span className="mt-0.5 block text-xs text-slate-500">
                    Buyer-eligible estimate: {estimate ? formatPortalBuyerEstimate(estimate) : "Unknown"}
                  </span>
                </span>
              </label>
              <label className="flex min-h-10 items-center gap-2 text-xs text-slate-600">
                <input
                  type="radio"
                  name="portal-map-inspect-bucket"
                  checked={inspectAgeBucket === option.value}
                  onChange={() => onInspect(option.value)}
                />
                Inspect this bucket on the map
              </label>
            </div>
            <div className="grid min-w-0 gap-1">
              <Label htmlFor={quantityId}>Quantity</Label>
              <Input
                id={quantityId}
                type="number"
                min={1}
                max={1_000_000}
                disabled={!selected}
                value={selected ? quantities[option.value] : ""}
                aria-label={`${option.label} quantity`}
                onChange={(event) => onQuantity(option.value, Number(event.target.value))}
              />
              {priced ? (
                <p className="text-xs text-slate-600">
                  {priced.unitPriceLabel}
                  {priced.lineTotalCents != null ? ` · ${priced.lineTotalLabel}` : ""}
                </p>
              ) : null}
            </div>
          </div>
        );
      })}
      {evaluatedAt ? (
        <p className="text-xs text-slate-500">
          Availability checked {new Date(evaluatedAt).toLocaleString()}. This estimate does not
          reserve inventory.
        </p>
      ) : null}
      {availabilityNote ? <p className="text-xs text-slate-600">{availabilityNote}</p> : null}
      {adjustmentLabels.length > 0 ? (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-950">
          <p>
            Availability changed for {adjustmentLabels.join(", ")}. Your quantities were not
            changed. Confirm the new estimate before submitting.
          </p>
          <label className="mt-2 flex min-h-10 items-start gap-2">
            <input
              type="checkbox"
              className="mt-1"
              checked={acknowledged}
              onChange={(event) => onAcknowledge(event.target.checked)}
            />
            <span>I reviewed the updated availability estimate.</span>
          </label>
        </div>
      ) : null}
    </fieldset>
  );
}

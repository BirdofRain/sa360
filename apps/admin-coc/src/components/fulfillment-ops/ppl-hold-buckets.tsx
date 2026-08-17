import type { PplHoldCatalogBucket } from "@/lib/fulfillment-ops/ppl-pricing-catalog";
import { presentationLabelForBucket } from "@/lib/fulfillment-ops/ppl-pricing-catalog";

export function PplHoldBucketsDisplay({ buckets }: { buckets: PplHoldCatalogBucket[] }) {
  if (buckets.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-2" data-testid="ppl-hold-buckets">
      {buckets.map((bucket) => (
        <span
          key={bucket.key}
          data-testid={`hold-bucket-${bucket.key}`}
          className="inline-flex items-center rounded-md border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-medium text-amber-950"
        >
          {presentationLabelForBucket(bucket.key, bucket.label)} — {bucket.status}
        </span>
      ))}
    </div>
  );
}

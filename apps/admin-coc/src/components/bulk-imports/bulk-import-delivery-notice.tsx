import {
  deriveBulkImportExternalWriteState,
  EXTERNAL_WRITE_STATE_LABELS,
} from "@/lib/bulk-imports/external-write-state";

type Props = {
  batch: {
    status: string;
    rows?: Array<{ sourceLeadEventId?: string | null; deliveryStatus?: string }>;
  };
};

export function BulkImportDeliveryNotice({ batch }: Props) {
  const state = deriveBulkImportExternalWriteState(batch);
  return (
    <div className="rounded-lg border border-blue-200 bg-blue-50/60 p-4 text-sm space-y-2">
      <p>
        CSV rows are stored in SA360 Source Intake first. No GHL contacts are created until a
        successful simulation is reviewed and a delivery wave is explicitly approved.
      </p>
      <p>
        <strong>External writes:</strong> {EXTERNAL_WRITE_STATE_LABELS[state]}
      </p>
    </div>
  );
}

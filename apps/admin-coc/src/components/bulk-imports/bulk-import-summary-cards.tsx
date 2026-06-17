type SummaryCard = {
  label: string;
  value: number | string;
  hint?: string;
};

export function BulkImportSummaryCards({
  summary,
  batchStatus,
}: {
  summary: Record<string, unknown>;
  batchStatus: string;
}) {
  const cards: SummaryCard[] = [
    { label: "Batch status", value: batchStatus },
    { label: "Total rows", value: Number(summary.totalRows ?? 0) },
    {
      label: "Identity eligible",
      value: Number(summary.identityEligible ?? summary.validIdentity ?? 0),
    },
    {
      label: "Source Intake records ready",
      value: Number(summary.normalizedSourceEvents ?? 0),
    },
    {
      label: "Eligible for simulation",
      value: Number(summary.eligibleForSimulation ?? 0),
      hint:
        Number(summary.missingSourceEvent ?? 0) > 0
          ? `${Number(summary.missingSourceEvent)} missing Source Intake record(s)`
          : undefined,
    },
    {
      label: "Normalization failed",
      value: Number(summary.normalizationFailed ?? 0),
    },
    { label: "Identity blocked", value: Number(summary.blockedIdentity ?? 0) },
    { label: "Duplicate review", value: Number(summary.duplicateReview ?? 0) },
    { label: "Mapping required", value: Number(summary.mappingRequired ?? 0) },
    { label: "Excluded", value: Number(summary.excluded ?? 0) },
    { label: "Simulated rows", value: Number(summary.simulatedRows ?? 0) },
    { label: "Delivered rows", value: Number(summary.deliveredRows ?? 0) },
    { label: "Failed rows", value: Number(summary.failedRows ?? 0) },
  ];

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {cards.map((card) => (
        <div key={card.label} className="rounded-lg border bg-muted/30 p-3">
          <p className="text-xs text-muted-foreground">{card.label}</p>
          <p className="text-lg font-semibold">{card.value}</p>
          {card.hint ? <p className="text-xs text-amber-800">{card.hint}</p> : null}
        </div>
      ))}
    </div>
  );
}

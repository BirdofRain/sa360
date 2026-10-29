/**
 * One stored lead gets one sheet write on a worksheet.
 * A captured test and automatic campaign delivery use different idempotency
 * keys. This guard reads both records before either path appends again.
 * A failed attempt that never started an append can still be retried on its
 * own key. An uncertain, running, or already-written record blocks the other path.
 */

export type SheetsEventWriteSnapshot = {
  id: string;
  status: string;
  rowsWritten: number;
  appendStartedAt: Date | null;
  idempotencyKey: string;
};

export type SheetsEventWriteDisposition = "clear" | "already_written" | "hold";

export function sheetsEventWriteDisposition(
  jobs: readonly SheetsEventWriteSnapshot[],
  ownIdempotencyKey: string
): SheetsEventWriteDisposition {
  const others = jobs.filter((job) => job.idempotencyKey !== ownIdempotencyKey);
  if (others.some((job) => job.status === "succeeded" || job.rowsWritten > 0)) return "already_written";
  const blocking = others.some((job) => !preSendFailure(job));
  return blocking ? "hold" : "clear";
}

export function sheetsEventAlreadyWritten(
  jobs: readonly SheetsEventWriteSnapshot[],
  ownIdempotencyKey: string
): SheetsEventWriteSnapshot | null {
  return (
    jobs.find(
      (job) => job.idempotencyKey !== ownIdempotencyKey && (job.status === "succeeded" || job.rowsWritten > 0)
    ) ?? null
  );
}

function preSendFailure(job: SheetsEventWriteSnapshot): boolean {
  return job.status === "failed" && job.appendStartedAt == null && job.rowsWritten === 0;
}

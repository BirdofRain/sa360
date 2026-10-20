export class HistoricalOwnershipPreviewError extends Error {
  readonly details: Record<string, string | string[]> | undefined;

  constructor(readonly failureCode: string, details?: Record<string, string | string[]>) {
    super(failureCode);
    this.name = "HistoricalOwnershipPreviewError";
    this.details = details;
  }
}

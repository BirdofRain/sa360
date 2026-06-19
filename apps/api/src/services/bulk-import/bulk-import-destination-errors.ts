export class BulkImportDestinationError extends Error {
  readonly code: string;
  readonly linkedClientAccountId?: string;

  constructor(code: string, message: string, linkedClientAccountId?: string) {
    super(message);
    this.name = "BulkImportDestinationError";
    this.code = code;
    this.linkedClientAccountId = linkedClientAccountId;
  }
}

export function bulkImportDestinationErrorMessage(err: BulkImportDestinationError): string {
  return err.message;
}

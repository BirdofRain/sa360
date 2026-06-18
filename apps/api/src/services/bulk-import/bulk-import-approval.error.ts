export class BulkImportApprovalError extends Error {
  readonly code: string;
  readonly blockers: string[];

  constructor(code: string, blockers: string[] = [], message?: string) {
    super(message ?? code);
    this.name = "BulkImportApprovalError";
    this.code = code;
    this.blockers = blockers;
  }
}

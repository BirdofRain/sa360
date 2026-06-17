export const META_DISPATCH_QUEUE = "meta-dispatch";
export const META_DISPATCH_JOB = "dispatch-event";

export const BULK_IMPORT_DELIVERY_QUEUE = "bulk-import-delivery";
export const BULK_IMPORT_DELIVERY_JOB = "bulk-import-deliver-chunk";

export const BULK_IMPORT_APPROVE_DELIVERY_CONFIRMATION =
  "APPROVE BULK LEAD DELIVERY" as const;

export const BULK_IMPORT_DELETE_CONFIRMATION = "DELETE BULK IMPORT" as const;
export const BULK_IMPORT_CANCEL_CONFIRMATION = "CANCEL BULK IMPORT" as const;
export const BULK_IMPORT_RESET_CONFIRMATION = "RESET BULK IMPORT" as const;

export const BULK_IMPORT_DEFAULT_MAX_DELIVERY_WAVE = 250;
export const BULK_IMPORT_DEFAULT_CHUNK_SIZE = 25;
export const BULK_IMPORT_DEFAULT_CHUNK_DELAY_MS = 2_000;
export const BULK_IMPORT_MAX_FILE_BYTES = 10 * 1024 * 1024;
export const BULK_IMPORT_MAX_ROWS = 10_000;
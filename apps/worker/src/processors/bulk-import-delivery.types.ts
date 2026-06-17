export type BulkImportDeliveryJobData = {
  batchId: string;
  rowIds: string[];
  mode: "simulate" | "live_canary";
  approvedBy?: string;
  chunkIndex?: number;
};

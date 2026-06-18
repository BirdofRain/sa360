import { redis } from "../lib/redis.js";
import { logger } from "../lib/logger.js";

function safeApiHostname(): string | null {
  const url = process.env.SA360_API_INTERNAL_URL?.trim();
  if (!url) return null;
  try {
    return new URL(url).hostname;
  } catch {
    return null;
  }
}

export function logBulkImportWorkerStartupDiagnostics(): void {
  const hostname = safeApiHostname();
  logger.info("bulk_import.worker.startup_diagnostics", {
    apiInternalHostnameConfigured: Boolean(hostname),
    apiInternalHostname: hostname,
    adminKeyPresent: Boolean(process.env.ADMIN_API_KEY?.trim()),
    redisConnected: redis.status === "ready",
    bulkImportQueueWorkerActive: true,
    configuredConcurrency: Number(process.env.BULK_IMPORT_DELIVERY_CONCURRENCY || 2),
  });
}

import {
  collectionAvailability,
  readArray,
  type CollectionAvailability,
} from "@/lib/action-center/defensive-payload";
import type { AutomationSignalHealth } from "@/lib/admin-api/types";

export type PresentedSignalEvent = { eventNameInternal: string; count: number };
export type PresentedFailedWebhookLog = {
  id: string;
  receivedAt: string;
  processingStatus: string;
  eventNameInternal: string | null;
  clientAccountId: string | null;
  errorSummary: string | null;
};

export type PresentedAutomationSignalHealth = {
  signalSent: number | null;
  signalFailed: number | null;
  webhookFailures: number | null;
  duplicatesOrSkipped: number | null;
  eventsByInternalName: PresentedSignalEvent[];
  eventsAvailability: CollectionAvailability;
  failedWebhookLogs: PresentedFailedWebhookLog[];
  failedWebhookLogsAvailability: CollectionAvailability;
};

function readCount(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function presentAutomationSignalHealth(
  signal: Partial<AutomationSignalHealth> | null | undefined
): PresentedAutomationSignalHealth {
  const events = readArray<PresentedSignalEvent>(signal?.eventsByInternalName);
  const failed = readArray<PresentedFailedWebhookLog>(signal?.failedWebhookLogs);
  return {
    signalSent: readCount(signal?.signalSent),
    signalFailed: readCount(signal?.signalFailed),
    webhookFailures: readCount(signal?.webhookFailures),
    duplicatesOrSkipped: readCount(signal?.duplicatesOrSkipped),
    eventsByInternalName: events.items,
    eventsAvailability: collectionAvailability(events.available, events.items.length),
    failedWebhookLogs: failed.items,
    failedWebhookLogsAvailability: collectionAvailability(failed.available, failed.items.length),
  };
}

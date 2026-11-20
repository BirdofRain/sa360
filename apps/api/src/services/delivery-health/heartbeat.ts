/**
 * Heartbeat for the delivery-health scanner.
 * Writes stay on DeliveryHealthMonitorHeartbeat and do not touch delivery rows.
 */

import type { PrismaClient } from "@prisma/client";

import { scrubDeliveryHealthText } from "./evidence.js";

export const DELIVERY_HEALTH_HEARTBEAT_ID = "delivery_health_sheets";

export type DeliveryHealthHeartbeatSnapshot = {
  lastStartedAt: Date | null;
  lastSucceededAt: Date | null;
  lastFailedAt: Date | null;
  consecutiveFailures: number;
  lastError: string | null;
  lastMonitorNotifiedAt: Date | null;
  lastMonitorNotificationKey: string | null;
};

export type MonitorFollowUp = "scanner_failed" | "heartbeat_stale" | "recovered";

const HEARTBEAT_SELECT = {
  lastStartedAt: true,
  lastSucceededAt: true,
  lastFailedAt: true,
  consecutiveFailures: true,
  lastError: true,
  lastMonitorNotifiedAt: true,
  lastMonitorNotificationKey: true,
} as const;

export function monitorFollowUp(input: {
  prior: DeliveryHealthHeartbeatSnapshot | null;
  now: Date;
  staleMs: number;
  succeeded: boolean;
}): MonitorFollowUp | null {
  if (!input.succeeded) return "scanner_failed";
  const prior = input.prior;
  if (!prior) return null;
  const anchor = prior.lastSucceededAt ?? prior.lastStartedAt;
  const stale = anchor != null && input.now.getTime() - anchor.getTime() > input.staleMs;
  const failed = prior.consecutiveFailures > 0;
  if ((failed || stale) && prior.lastMonitorNotifiedAt) return "recovered";
  if (stale) return "heartbeat_stale";
  return null;
}

export function monitorNoticeKey(input: {
  reason: MonitorFollowUp;
  now: Date;
  cooldownMs: number;
  prior: DeliveryHealthHeartbeatSnapshot | null;
}): string {
  if (input.reason === "recovered") {
    const stamp = (input.prior?.lastFailedAt ?? input.prior?.lastStartedAt ?? input.now).toISOString();
    return `dh-monitor:recovered:${stamp}`;
  }
  const cooldown = Math.max(1, input.cooldownMs);
  const bucket = Math.floor(input.now.getTime() / cooldown);
  return `dh-monitor:${input.reason}:${bucket}`;
}

export async function readDeliveryHealthHeartbeat(
  db: PrismaClient
): Promise<DeliveryHealthHeartbeatSnapshot | null> {
  return db.deliveryHealthMonitorHeartbeat.findUnique({
    where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    select: HEARTBEAT_SELECT,
  });
}

export async function recordDeliveryHealthHeartbeatStart(db: PrismaClient, now: Date): Promise<void> {
  await db.deliveryHealthMonitorHeartbeat.upsert({
    where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    create: { id: DELIVERY_HEALTH_HEARTBEAT_ID, lastStartedAt: now, consecutiveFailures: 0 },
    update: { lastStartedAt: now },
  });
}

export async function recordDeliveryHealthHeartbeatSuccess(db: PrismaClient, now: Date): Promise<void> {
  await db.deliveryHealthMonitorHeartbeat.update({
    where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    data: { lastSucceededAt: now, consecutiveFailures: 0, lastError: null },
  });
}

export async function recordDeliveryHealthHeartbeatFailure(
  db: PrismaClient,
  now: Date,
  error: string
): Promise<void> {
  await db.deliveryHealthMonitorHeartbeat.update({
    where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    data: {
      lastFailedAt: now,
      consecutiveFailures: { increment: 1 },
      lastError: scrubDeliveryHealthText(error, 240),
    },
  });
}

export async function recordDeliveryHealthMonitorNotice(
  db: PrismaClient,
  input: { key: string; notifiedAt: Date | null }
): Promise<void> {
  await db.deliveryHealthMonitorHeartbeat.update({
    where: { id: DELIVERY_HEALTH_HEARTBEAT_ID },
    data: {
      lastMonitorNotificationKey: input.key,
      ...(input.notifiedAt ? { lastMonitorNotifiedAt: input.notifiedAt } : {}),
    },
  });
}

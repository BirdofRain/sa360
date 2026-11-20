/**
 * Delivery health flags are exact-string "true". Unset, empty, and "TRUE"
 * leave the monitor and the mailer off.
 * Pilot membership is a list of clientAccountId values. Display names are
 * rejected and are not logged.
 */

export type DeliveryHealthConfig = {
  monitorEnabled: boolean;
  notifyEnabled: boolean;
  pilotClientIds: string[];
  pilotIdsRejected: number;
  recipients: string[];
  cooldownMs: number;
  lookbackMs: number;
  staleMs: number;
};

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;

function exactTrue(value: string | undefined): boolean {
  return value?.trim() === "true";
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  if (raw == null || raw.trim() === "") return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return fallback;
  const whole = Math.trunc(parsed);
  if (whole < min || whole > max) return fallback;
  return whole;
}

function pilotIds(raw: string | undefined): { ids: string[]; rejected: number } {
  const ids: string[] = [];
  let rejected = 0;
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    if (/\s/.test(trimmed) || trimmed.includes("@") || trimmed.length > 128) {
      rejected += 1;
      continue;
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    ids.push(trimmed);
  }
  return { ids, rejected };
}

function recipients(raw: string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? "").split(",")) {
    const trimmed = part.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) continue;
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(trimmed);
  }
  return out;
}

export function readDeliveryHealthConfig(env: NodeJS.ProcessEnv = process.env): DeliveryHealthConfig {
  const pilots = pilotIds(env.SA360_DELIVERY_HEALTH_PILOT_CLIENT_IDS);
  return {
    monitorEnabled: exactTrue(env.SA360_DELIVERY_HEALTH_MONITOR_ENABLED),
    notifyEnabled: exactTrue(env.SA360_DELIVERY_HEALTH_NOTIFY_ENABLED),
    pilotClientIds: pilots.ids,
    pilotIdsRejected: pilots.rejected,
    recipients: recipients(env.SA360_DELIVERY_HEALTH_NOTIFY_RECIPIENTS),
    cooldownMs: clampInt(env.SA360_DELIVERY_HEALTH_NOTIFY_COOLDOWN_SECONDS, 3600, 60, 86_400) * 1000,
    lookbackMs: clampInt(env.SA360_DELIVERY_HEALTH_LOOKBACK_HOURS, 48, 1, 168) * HOUR,
    staleMs: clampInt(env.SA360_DELIVERY_HEALTH_HEARTBEAT_STALE_SECONDS, 300, 60, 86_400) * 1000,
  };
}

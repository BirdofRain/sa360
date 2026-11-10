import {
  STAFF_GOOGLE_STATE_REPLAY_PREFIX,
  STAFF_GOOGLE_STATE_REPLAY_TTL_SECONDS,
} from "@sa360/shared/staff-google-state";

import { redis as defaultRedis } from "./redis.js";

export const STAFF_GOOGLE_STATE_CLAIM_TIMEOUT_MS = 1_500;
const REPLAY_ID_PATTERN = /^[a-f0-9]{64}$/;

export type StaffGoogleStateClaim = "claimed" | "reused" | "unavailable";

export type StaffGoogleReplayRedis = {
  set(key: string, value: string, expiryMode: "EX", ttlSeconds: number, condition: "NX"): Promise<string | null>;
};

export async function claimStaffGoogleStateReplay(
  replayId: string,
  client: StaffGoogleReplayRedis = redisCommands(defaultRedis),
  timeoutMs = STAFF_GOOGLE_STATE_CLAIM_TIMEOUT_MS
): Promise<StaffGoogleStateClaim> {
  if (!REPLAY_ID_PATTERN.test(replayId)) return "unavailable";
  const key = `${STAFF_GOOGLE_STATE_REPLAY_PREFIX}${replayId}`;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      client.set(key, "1", "EX", STAFF_GOOGLE_STATE_REPLAY_TTL_SECONDS, "NX"),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("staff_google_state_claim_timeout")), timeoutMs);
      }),
    ]);
    if (result === "OK") return "claimed";
    if (result === null) return "reused";
    return "unavailable";
  } catch {
    return "unavailable";
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function redisCommands(client: StaffGoogleReplayRedis): StaffGoogleReplayRedis {
  return {
    set: (key, value, expiryMode, ttlSeconds, condition) => client.set(key, value, expiryMode, ttlSeconds, condition),
  };
}

/**
 * API global gate for Meta dispatch (BullMQ enqueue).
 * Reads META_SYNC_ENABLED after dotenv has loaded (see server.ts / redis.ts).
 * When unset or empty, defaults to true so existing deployments keep enqueueing.
 */
export function isGlobalMetaSyncEnabled(): boolean {
  const raw = process.env.META_SYNC_ENABLED;
  if (raw === undefined || raw.trim() === "") {
    return true;
  }
  return ["true", "1", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

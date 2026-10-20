const KEY_PATTERN = /^[A-Za-z0-9:_-]{8,200}$/;
const PENDING = "pending";
const TTL_SECONDS = 60 * 60 * 48;

export type PortalOrderIdempotencyClaim =
  | { status: "acquired" }
  | { status: "replay"; orderId: string }
  | { status: "in_progress" }
  | { status: "invalid" }
  | { status: "unavailable" };

export type PortalOrderIdempotencyStore = {
  claim(key: string): Promise<"acquired" | "pending" | string>;
  complete(key: string, orderId: string): Promise<void>;
  release(key: string): Promise<void>;
};

export function portalOrderIdempotencyStorageKey(
  clientAccountId: string,
  idempotencyKey: string
): string {
  return `portal:lead-order:idempotency:${clientAccountId.trim()}:${idempotencyKey.trim()}`;
}

export function isPortalOrderIdempotencyKey(value: string): boolean {
  return KEY_PATTERN.test(value.trim());
}

export async function claimPortalOrderIdempotency(
  clientAccountId: string,
  idempotencyKey: string | undefined,
  store: PortalOrderIdempotencyStore | null
): Promise<PortalOrderIdempotencyClaim> {
  const key = idempotencyKey?.trim() ?? "";
  if (!key) return { status: "acquired" };
  if (!isPortalOrderIdempotencyKey(key)) return { status: "invalid" };
  if (!store) return { status: "unavailable" };
  try {
    const storageKey = portalOrderIdempotencyStorageKey(clientAccountId, key);
    const claimed = await store.claim(storageKey);
    if (claimed === "acquired") return { status: "acquired" };
    if (claimed === PENDING) return { status: "in_progress" };
    if (claimed.trim()) return { status: "replay", orderId: claimed.trim() };
    return { status: "unavailable" };
  } catch {
    return { status: "unavailable" };
  }
}

type RedisLike = {
  set(key: string, value: string, expiryMode: "EX", ttl: number, condition?: "NX"): Promise<"OK" | null>;
  get(key: string): Promise<string | null>;
  del(key: string): Promise<number>;
};

export function redisPortalOrderIdempotencyStore(redis: RedisLike): PortalOrderIdempotencyStore {
  return {
    async claim(key) {
      const created = await redis.set(key, PENDING, "EX", TTL_SECONDS, "NX");
      if (created === "OK") return "acquired";
      const existing = await redis.get(key);
      return existing ?? PENDING;
    },
    async complete(key, orderId) {
      await redis.set(key, orderId, "EX", TTL_SECONDS);
    },
    async release(key) {
      const current = await redis.get(key);
      if (current === PENDING) await redis.del(key);
    },
  };
}

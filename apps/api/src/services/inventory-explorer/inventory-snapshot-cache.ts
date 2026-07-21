import type { Redis } from "ioredis";

import type {
  InventoryNicheKey,
  NormalizedInventorySnapshot,
} from "@sa360/shared";

import { inventoryCacheKey } from "./inventory-explorer.types.js";

export type CachedInventorySnapshot = {
  snapshot: NormalizedInventorySnapshot;
  cachedAt: string;
};

type MemoryEntry = {
  value: CachedInventorySnapshot;
  expiresAt: number;
};

const DEFAULT_L1_TTL_MS = 45_000;

/**
 * Valid-only snapshot cache: Redis (durable fallback) + process memory L1.
 * Invalid live payloads must never call set().
 */
export class InventorySnapshotCache {
  private readonly memory = new Map<string, MemoryEntry>();

  constructor(
    private readonly redis: Redis | null,
    private readonly l1TtlMs = DEFAULT_L1_TTL_MS
  ) {}

  async get(
    nicheKey: InventoryNicheKey
  ): Promise<CachedInventorySnapshot | null> {
    const key = inventoryCacheKey(nicheKey);
    const now = Date.now();
    const mem = this.memory.get(key);
    if (mem && mem.expiresAt > now) {
      return mem.value;
    }

    if (!this.redis) return mem?.value ?? null;

    try {
      const raw = await this.redis.get(key);
      if (!raw) return null;
      const parsed = JSON.parse(raw) as CachedInventorySnapshot;
      if (!parsed?.snapshot?.bundle || !parsed.cachedAt) return null;
      this.memory.set(key, {
        value: parsed,
        expiresAt: now + this.l1TtlMs,
      });
      return parsed;
    } catch {
      return mem?.value ?? null;
    }
  }

  /**
   * Persist only cache-eligible (validated) snapshots.
   * Soft TTL metadata is tracked via cachedAt; keys are not deleted on soft expiry.
   */
  async set(
    nicheKey: InventoryNicheKey,
    snapshot: NormalizedInventorySnapshot
  ): Promise<boolean> {
    if (!snapshot.cacheEligible) return false;

    const payload: CachedInventorySnapshot = {
      snapshot,
      cachedAt: new Date().toISOString(),
    };
    const key = inventoryCacheKey(nicheKey);
    this.memory.set(key, {
      value: payload,
      expiresAt: Date.now() + this.l1TtlMs,
    });

    if (!this.redis) return true;

    try {
      // No EXPIRE: retain last valid snapshot indefinitely for outage fallback.
      await this.redis.set(key, JSON.stringify(payload));
      return true;
    } catch {
      // Memory write already succeeded.
      return true;
    }
  }

  /** Test helper — clear L1 (and Redis key when available). */
  async clear(nicheKey: InventoryNicheKey): Promise<void> {
    const key = inventoryCacheKey(nicheKey);
    this.memory.delete(key);
    if (!this.redis) return;
    try {
      await this.redis.del(key);
    } catch {
      // ignore
    }
  }
}

import { STAFF_SESSION_TTL_SECONDS, staffSessionRegistryKey, type StaffSessionClaims } from "@sa360/shared/staff-google-session";

import { redis as defaultRedis } from "./redis.js";

export const STAFF_SESSION_REGISTRY_TIMEOUT_MS = 1_500;

const REGISTER_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then
  return 'rejected'
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
return 'registered'
`;

const REVOKE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if current and string.find(current, 'v1|revoked|', 1, true) == 1 then
  return 'revoked'
end
if not current then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
  return 'revoked'
end
local pttl = redis.call('PTTL', KEYS[1])
if pttl < 1 then
  redis.call('SET', KEYS[1], ARGV[1], 'EX', tonumber(ARGV[2]))
  return 'revoked'
end
redis.call('SET', KEYS[1], ARGV[1], 'PX', pttl)
return 'revoked'
`;

export type StaffSessionRegisterResult = "registered" | "rejected" | "unavailable";
export type StaffSessionReadResult = "active" | "revoked" | "missing" | "unavailable";
export type StaffSessionRevokeResult = "revoked" | "unavailable";

export type StaffSessionRegistry = {
  register(claims: StaffSessionClaims, nowSec: number): Promise<StaffSessionRegisterResult>;
  read(claims: StaffSessionClaims, nowSec: number): Promise<StaffSessionReadResult>;
  revoke(claims: StaffSessionClaims, nowSec: number): Promise<StaffSessionRevokeResult>;
};

type RegistryEntry = { value: string; expiresAtSec: number };

type RegistryRedis = {
  eval(script: string, numkeys: number, key: string, value: string, ttl: string): Promise<unknown>;
  get(key: string): Promise<string | null>;
};

export function createMemoryStaffSessionRegistry(): StaffSessionRegistry {
  const entries = new Map<string, RegistryEntry>();
  let chain = Promise.resolve();
  const run = <T>(operation: () => T): Promise<T> => {
    const next = chain.then(operation);
    chain = next.then(
      () => undefined,
      () => undefined
    );
    return next;
  };
  return {
    register: (claims, nowSec) => run(() => registerEntry(entries, claims, nowSec)),
    read: (claims, nowSec) => run(() => readEntry(entries, claims, nowSec)),
    revoke: (claims, nowSec) => run(() => revokeEntry(entries, claims, nowSec)),
  };
}

export function createRedisStaffSessionRegistry(
  client: RegistryRedis = redisCommands(defaultRedis),
  timeoutMs = STAFF_SESSION_REGISTRY_TIMEOUT_MS
): StaffSessionRegistry {
  return {
    async register(claims, nowSec) {
      const ttl = registryTtl(claims, nowSec);
      if (!ttl) return "unavailable";
      const result = await command(
        () => client.eval(REGISTER_SCRIPT, 1, staffSessionRegistryKey(claims.jti), activeValue(claims), String(ttl)),
        timeoutMs
      );
      if (result === "registered" || result === "rejected") return result;
      return "unavailable";
    },
    async read(claims, nowSec) {
      const raw = await command(() => client.get(staffSessionRegistryKey(claims.jti)), timeoutMs);
      if (raw === undefined) return "unavailable";
      return interpret(raw, claims, nowSec);
    },
    async revoke(claims, nowSec) {
      const ttl = registryTtl(claims, nowSec);
      if (!ttl) return "unavailable";
      const result = await command(
        () => client.eval(REVOKE_SCRIPT, 1, staffSessionRegistryKey(claims.jti), revokedValue(claims), String(ttl)),
        timeoutMs
      );
      return result === "revoked" ? "revoked" : "unavailable";
    },
  };
}

export function activeValue(claims: StaffSessionClaims): string {
  return `v1|active|${claims.sub}|${claims.googleSub}|${claims.exp}`;
}

export function revokedValue(claims: StaffSessionClaims): string {
  return `v1|revoked|${claims.sub}|${claims.googleSub}|${claims.exp}`;
}

function registerEntry(
  entries: Map<string, RegistryEntry>,
  claims: StaffSessionClaims,
  nowSec: number
): StaffSessionRegisterResult {
  const ttl = registryTtl(claims, nowSec);
  if (!ttl) return "unavailable";
  const key = staffSessionRegistryKey(claims.jti);
  const current = liveEntry(entries, key, nowSec);
  if (current) return "rejected";
  entries.set(key, { value: activeValue(claims), expiresAtSec: nowSec + ttl });
  return "registered";
}

function readEntry(entries: Map<string, RegistryEntry>, claims: StaffSessionClaims, nowSec: number): StaffSessionReadResult {
  return interpret(liveEntry(entries, staffSessionRegistryKey(claims.jti), nowSec)?.value ?? null, claims, nowSec);
}

function revokeEntry(
  entries: Map<string, RegistryEntry>,
  claims: StaffSessionClaims,
  nowSec: number
): StaffSessionRevokeResult {
  const ttl = registryTtl(claims, nowSec);
  if (!ttl) return "unavailable";
  const key = staffSessionRegistryKey(claims.jti);
  const current = liveEntry(entries, key, nowSec);
  if (current?.value.startsWith("v1|revoked|")) return "revoked";
  const expiresAtSec = current ? current.expiresAtSec : nowSec + ttl;
  entries.set(key, { value: revokedValue(claims), expiresAtSec });
  return "revoked";
}

function liveEntry(entries: Map<string, RegistryEntry>, key: string, nowSec: number): RegistryEntry | null {
  const entry = entries.get(key);
  if (!entry) return null;
  if (entry.expiresAtSec <= nowSec) {
    entries.delete(key);
    return null;
  }
  return entry;
}

function interpret(value: string | null, claims: StaffSessionClaims, nowSec: number): StaffSessionReadResult {
  if (!value) return "missing";
  const record = parseRecord(value);
  if (!record || record.exp <= nowSec) return "missing";
  if (record.state === "revoked") return "revoked";
  if (record.staffPrincipalId !== claims.sub || record.googleSub !== claims.googleSub || record.exp !== claims.exp) {
    return "missing";
  }
  return "active";
}

function parseRecord(value: string): { state: "active" | "revoked"; staffPrincipalId: string; googleSub: string; exp: number } | null {
  const parts = value.split("|");
  if (parts.length !== 5 || parts[0] !== "v1") return null;
  if (parts[1] !== "active" && parts[1] !== "revoked") return null;
  const exp = Number(parts[4]);
  if (!Number.isInteger(exp)) return null;
  return { state: parts[1], staffPrincipalId: parts[2] ?? "", googleSub: parts[3] ?? "", exp };
}

function registryTtl(claims: StaffSessionClaims, nowSec: number): number | null {
  const ttl = claims.exp - nowSec;
  if (!Number.isInteger(ttl) || ttl < 1) return null;
  return Math.min(ttl, STAFF_SESSION_TTL_SECONDS);
}

async function command<T>(operation: () => Promise<T>, timeoutMs: number): Promise<T | undefined> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error("staff_session_registry_timeout")), timeoutMs);
      }),
    ]);
  } catch {
    return undefined;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function redisCommands(client: RegistryRedis): RegistryRedis {
  return {
    eval: (script, numkeys, key, value, ttl) => client.eval(script, numkeys, key, value, ttl),
    get: (key) => client.get(key),
  };
}

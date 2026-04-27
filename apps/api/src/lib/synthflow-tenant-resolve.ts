import { normalizeToE164 } from "../services/phone-e164.service.js";
import type { InboundContactLookupScope } from "../repositories/inbound-contact-index.repository.js";
import {
  getSynthflowLookupClientAccountId,
  getSynthflowLookupSubaccountIdGhl,
} from "./synthflow-voice-env.js";

export type SynthflowTenantMapEntry = {
  clientAccountId: string;
  /** Omitted = any subaccount for that client; `""` = no subaccount row key. */
  subaccountIdGhl?: string;
};

/**
 * JSON from env `SYNTHFLOW_TENANT_RESOLUTION_MAP` (or `SYNTHFLOW_TENANT_RESOLUTION_MAP_JSON`):
 * { "byModelId": { "<model>": { "clientAccountId": "...", "subaccountIdGhl"?: "..." } },
 *   "byToNumberE164": { "+1...": { ... } } }
 * `byToNumberE164` keys should be E.164 (dashes ok; they are normalized on parse).
 */
export type SynthflowTenantResolutionMap = {
  byModelId?: Record<string, SynthflowTenantMapEntry>;
  byToNumberE164?: Record<string, SynthflowTenantMapEntry>;
};

function deepTrimNumberKeys(
  m: Record<string, SynthflowTenantMapEntry> | undefined
): Record<string, SynthflowTenantMapEntry> {
  if (!m) {
    return {};
  }
  const out: Record<string, SynthflowTenantMapEntry> = {};
  for (const [k, v] of Object.entries(m)) {
    const key = normalizeToE164(k) || k.trim();
    if (key) {
      out[key] = v;
    }
  }
  return out;
}

let cachedMap: { raw: string; map: SynthflowTenantResolutionMap } | null = null;

function readResolutionMapFromEnv(): SynthflowTenantResolutionMap {
  const raw =
    process.env.SYNTHFLOW_TENANT_RESOLUTION_MAP?.trim() ||
    process.env.SYNTHFLOW_TENANT_RESOLUTION_MAP_JSON?.trim() ||
    "";
  if (cachedMap && cachedMap.raw === raw) {
    return cachedMap.map;
  }
  if (!raw) {
    cachedMap = { raw, map: {} };
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as SynthflowTenantResolutionMap;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      cachedMap = { raw, map: {} };
      return {};
    }
    const byTo = deepTrimNumberKeys(parsed.byToNumberE164);
    cachedMap = {
      raw,
      map: { ...parsed, byToNumberE164: byTo },
    };
    return cachedMap.map;
  } catch {
    cachedMap = { raw, map: {} };
    return {};
  }
}

function entryToScope(entry: SynthflowTenantMapEntry): InboundContactLookupScope {
  const sub = entry.subaccountIdGhl;
  if (sub === undefined) {
    return { clientAccountId: entry.clientAccountId };
  }
  return { clientAccountId: entry.clientAccountId, subaccountIdGhl: sub };
}

function scopeToLogFields(
  scope: InboundContactLookupScope
): { clientAccountId: string; subaccountIdGhl: string } {
  return {
    clientAccountId: scope.clientAccountId ?? "",
    subaccountIdGhl: scope.subaccountIdGhl ?? "",
  };
}

export type SynthflowTenantResolveSource =
  | "model_id_map"
  | "to_number_map"
  | "env_default"
  | "none";

/**
 * Resolves multi-tenant scope for InboundContactIndex: request maps first, then
 * configured default (`SYNTHFLOW_LOOKUP_CLIENT_ACCOUNT_ID` / subaccount).
 */
export function resolveSynthflowInboundTenant(
  modelId: string,
  toE164Normalized: string
): {
  scope: InboundContactLookupScope | null;
  source: SynthflowTenantResolveSource;
  /** Populated when tenant was resolved; for logging and GHL cache. */
  resolvedClientAccountId: string;
  resolvedSubaccountIdGhl: string;
} {
  const map = readResolutionMapFromEnv();
  const mid = modelId.trim();

  if (mid && map.byModelId?.[mid]) {
    const s = entryToScope(map.byModelId[mid]!);
    const log = scopeToLogFields(s);
    return {
      scope: s,
      source: "model_id_map",
      resolvedClientAccountId: log.clientAccountId,
      resolvedSubaccountIdGhl: log.subaccountIdGhl,
    };
  }

  if (toE164Normalized && map.byToNumberE164?.[toE164Normalized]) {
    const s = entryToScope(map.byToNumberE164[toE164Normalized]!);
    const log = scopeToLogFields(s);
    return {
      scope: s,
      source: "to_number_map",
      resolvedClientAccountId: log.clientAccountId,
      resolvedSubaccountIdGhl: log.subaccountIdGhl,
    };
  }

  const defaultClient = getSynthflowLookupClientAccountId();
  if (defaultClient) {
    const su = getSynthflowLookupSubaccountIdGhl();
    const s: InboundContactLookupScope =
      su === undefined
        ? { clientAccountId: defaultClient }
        : { clientAccountId: defaultClient, subaccountIdGhl: su };
    return {
      scope: s,
      source: "env_default",
      resolvedClientAccountId: defaultClient,
      resolvedSubaccountIdGhl: su === undefined ? "" : su,
    };
  }

  return {
    scope: null,
    source: "none",
    resolvedClientAccountId: "",
    resolvedSubaccountIdGhl: "",
  };
}

/**
 * GHL InboundContactIndex backfill: prefer resolved scope (map or env default), else legacy env alone.
 */
export function resolveGhlIndexCacheTarget(resolution: {
  scope: InboundContactLookupScope | null;
}): { clientAccountId: string; subaccountIdGhl: string } | null {
  const s = resolution.scope;
  if (s?.clientAccountId) {
    return {
      clientAccountId: s.clientAccountId,
      subaccountIdGhl: s.subaccountIdGhl === undefined ? "" : s.subaccountIdGhl,
    };
  }
  const envC = getSynthflowLookupClientAccountId();
  if (envC) {
    return {
      clientAccountId: envC,
      subaccountIdGhl: getSynthflowLookupSubaccountIdGhl() ?? "",
    };
  }
  return null;
}

import type { Prisma } from "@prisma/client";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import {
  createGhlLocationConfigSnapshot,
  findLatestGhlLocationConfigSnapshot,
} from "../../repositories/ghl-location-config-snapshot.repository.js";
import {
  GHL_CONFIG_DISCOVERY_PATHS,
  ghlReadOnlyGet,
} from "./ghl-config-discovery-client.js";
import {
  assertNoTokensInGhlConfigPayload,
  snapshotToDiscoveryResult,
} from "./ghl-config-discovery.present.js";
import { buildSa360FieldMappingDiscoveryReport } from "../sa360-custom-field-mapping.service.js";
import {
  SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS,
  type GhlConfigDiscoveryResult,
  type GhlDiscoveredCustomField,
  type GhlDiscoveredLocation,
  type GhlDiscoveredPipeline,
  type GhlDiscoveredPipelineStage,
  type GhlDiscoveredTag,
  type GhlDiscoveredUser,
  type GhlDiscoveredWorkflow,
  type GhlRequiredFieldsReport,
} from "./ghl-config-discovery.types.js";

function asArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    for (const key of [
      "pipelines",
      "workflows",
      "users",
      "customFields",
      "tags",
      "data",
      "items",
      "results",
    ]) {
      if (Array.isArray(o[key])) return o[key] as unknown[];
    }
  }
  return [];
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

function parseLocation(json: unknown, locationId: string): GhlDiscoveredLocation {
  const root =
    json && typeof json === "object" && !Array.isArray(json)
      ? ((json as Record<string, unknown>).location ?? json)
      : null;
  const o =
    root && typeof root === "object" && !Array.isArray(root)
      ? (root as Record<string, unknown>)
      : {};
  return {
    id: str(o.id) ?? locationId,
    name: str(o.name) ?? str(o.locationName),
    companyId: str(o.companyId),
    timezone: str(o.timezone),
  };
}

/** @internal Exported for unit tests only. */
export function parsePipelines(json: unknown): GhlDiscoveredPipeline[] {
  return asArray(json)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const p = item as Record<string, unknown>;
      const id = str(p.id);
      if (!id) return null;
      const stagesRaw = p.stages ?? p.pipelineStages;
      const stages: GhlDiscoveredPipelineStage[] = asArray(stagesRaw)
        .map((s) => {
          if (!s || typeof s !== "object" || Array.isArray(s)) return null;
          const st = s as Record<string, unknown>;
          const sid = str(st.id);
          if (!sid) return null;
          const pos = typeof st.position === "number" ? st.position : null;
          return {
            id: sid,
            name: str(st.name) ?? sid,
            position: pos,
          };
        })
        .filter((x): x is GhlDiscoveredPipelineStage => x !== null);
      return {
        id,
        name: str(p.name) ?? id,
        stages,
      };
    })
    .filter((x): x is GhlDiscoveredPipeline => x !== null);
}

function parseWorkflows(json: unknown): GhlDiscoveredWorkflow[] {
  return asArray(json)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const w = item as Record<string, unknown>;
      const id = str(w.id);
      if (!id) return null;
      return {
        id,
        name: str(w.name) ?? id,
        status: str(w.status),
        type: str(w.type) ?? str(w.workflowType),
      };
    })
    .filter((x): x is GhlDiscoveredWorkflow => x !== null);
}

function parseUsers(json: unknown): GhlDiscoveredUser[] {
  return asArray(json)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const u = item as Record<string, unknown>;
      const id = str(u.id);
      if (!id) return null;
      const fullName = [str(u.firstName), str(u.lastName)].filter(Boolean).join(" ").trim();
      const name = str(u.name) ?? (fullName || null);
      return {
        id,
        name: name ?? id,
        email: str(u.email),
      };
    })
    .filter((x): x is GhlDiscoveredUser => x !== null);
}

function parsePicklistOptions(raw: unknown): string[] | null {
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item === "string" && item.trim()) {
      out.push(item.trim());
      continue;
    }
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    for (const key of ["label", "preFillValue", "prefillValue", "value", "name"]) {
      const v = record[key];
      if (typeof v === "string" && v.trim()) {
        out.push(v.trim());
        break;
      }
    }
  }
  return out.length > 0 ? [...new Set(out)] : null;
}

function parseCustomFields(json: unknown): GhlDiscoveredCustomField[] {
  return asArray(json)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const f = item as Record<string, unknown>;
      const id = str(f.id);
      if (!id) return null;
      return {
        id,
        name: str(f.name) ?? id,
        key: str(f.key),
        fieldKey: str(f.fieldKey),
        dataType: str(f.dataType),
        ...(parsePicklistOptions(f.picklistOptions ?? f.options)
          ? { picklistOptions: parsePicklistOptions(f.picklistOptions ?? f.options) }
          : {}),
      };
    })
    .filter((x): x is GhlDiscoveredCustomField => x !== null);
}

function parseTags(json: unknown): GhlDiscoveredTag[] {
  return asArray(json)
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const t = item as Record<string, unknown>;
      const id = str(t.id) ?? str(t.name);
      const name = str(t.name) ?? id;
      if (!id || !name) return null;
      return { id, name };
    })
    .filter((x): x is GhlDiscoveredTag => x !== null);
}

function normalizeFieldKey(field: GhlDiscoveredCustomField): string | null {
  const candidates = [field.fieldKey, field.key, field.name]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.trim().toLowerCase());
  for (const c of candidates) {
    if (c.startsWith("sa360_") || c.includes("sa360_")) {
      const match = SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS.find(
        (k) => c === k || c.endsWith(k) || c.includes(k)
      );
      return match ?? (c.startsWith("sa360_") ? c.replace(/^.*?(sa360_.*)$/, "$1") : null);
    }
  }
  return null;
}

export function detectSa360RequiredCustomFields(
  fields: GhlDiscoveredCustomField[]
): GhlRequiredFieldsReport {
  const found = new Set<string>();
  for (const field of fields) {
    const normalized = normalizeFieldKey(field);
    if (!normalized) continue;
    for (const key of SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS) {
      if (normalized === key || normalized.endsWith(key) || field.fieldKey === key) {
        found.add(key);
      }
    }
    for (const key of SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS) {
      const hay = [field.fieldKey, field.key, field.name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      if (hay.includes(key)) found.add(key);
    }
  }
  const foundRequiredFields = SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS.filter((k) =>
    found.has(k)
  );
  const missingRequiredFields = SA360_REQUIRED_GHL_CUSTOM_FIELD_KEYS.filter(
    (k) => !found.has(k)
  );
  return {
    requiredFieldsInstalled: missingRequiredFields.length === 0,
    missingRequiredFields: [...missingRequiredFields],
    foundRequiredFields: [...foundRequiredFields],
  };
}

async function fetchDiscoveryLive(
  locationId: string,
  fetchImpl: typeof fetch
): Promise<GhlConfigDiscoveryResult> {
  const trimmed = locationId.trim();
  const errors: string[] = [];
  const warnings: string[] = [];
  const query = { locationId: trimmed };

  const locationRes = await ghlReadOnlyGet(
    trimmed,
    GHL_CONFIG_DISCOVERY_PATHS.location(trimmed),
    undefined,
    fetchImpl
  );
  const location = locationRes.ok
    ? parseLocation(locationRes.json, trimmed)
    : { id: trimmed, name: null, companyId: null, timezone: null };
  if (!locationRes.ok) errors.push(`location: ${locationRes.errorMessage}`);

  const pipelinesRes = await ghlReadOnlyGet(
    trimmed,
    GHL_CONFIG_DISCOVERY_PATHS.pipelines,
    query,
    fetchImpl
  );
  const pipelines = pipelinesRes.ok ? parsePipelines(pipelinesRes.json) : [];
  if (!pipelinesRes.ok) errors.push(`pipelines: ${pipelinesRes.errorMessage}`);

  const workflowsRes = await ghlReadOnlyGet(
    trimmed,
    GHL_CONFIG_DISCOVERY_PATHS.workflows,
    query,
    fetchImpl
  );
  const workflows = workflowsRes.ok ? parseWorkflows(workflowsRes.json) : [];
  if (!workflowsRes.ok) warnings.push(`workflows: ${workflowsRes.errorMessage}`);

  const usersRes = await ghlReadOnlyGet(
    trimmed,
    GHL_CONFIG_DISCOVERY_PATHS.users,
    query,
    fetchImpl
  );
  const users = usersRes.ok ? parseUsers(usersRes.json) : [];
  if (!usersRes.ok) warnings.push(`users: ${usersRes.errorMessage}`);

  const fieldsRes = await ghlReadOnlyGet(
    trimmed,
    GHL_CONFIG_DISCOVERY_PATHS.customFields(trimmed),
    undefined,
    fetchImpl
  );
  const customFields = fieldsRes.ok ? parseCustomFields(fieldsRes.json) : [];
  if (!fieldsRes.ok) warnings.push(`customFields: ${fieldsRes.errorMessage}`);

  const tagsRes = await ghlReadOnlyGet(
    trimmed,
    GHL_CONFIG_DISCOVERY_PATHS.tags(trimmed),
    undefined,
    fetchImpl
  );
  const tags = tagsRes.ok ? parseTags(tagsRes.json) : [];
  if (!tagsRes.ok) warnings.push(`tags: ${tagsRes.errorMessage}`);

  const requiredFields = detectSa360RequiredCustomFields(customFields);
  const sa360FieldMapping = buildSa360FieldMappingDiscoveryReport(customFields);
  const fetchedAt = new Date().toISOString();

  return {
    location,
    pipelines,
    workflows,
    users,
    customFields,
    tags,
    fetchedAt,
    fromCache: false,
    warnings,
    errors,
    requiredFields,
    sa360FieldMapping,
  };
}

export type DiscoverGhlLocationConfigDeps = {
  findGhlLocationConnectionByLocationId?: typeof findGhlLocationConnectionByLocationId;
};

export async function discoverGhlLocationConfig(
  input: {
    locationId: string;
    refresh?: boolean;
    clientAccountId?: string | null;
    fetchImpl?: typeof fetch;
  },
  deps: DiscoverGhlLocationConfigDeps = {}
): Promise<
  | { ok: true; discovery: GhlConfigDiscoveryResult }
  | { ok: false; error: string; code: "NOT_CONNECTED" | "NOT_FOUND" }
> {
  const locationId = input.locationId.trim();
  if (!locationId) {
    return { ok: false, error: "locationId is required.", code: "NOT_FOUND" };
  }

  const findConnection =
    deps.findGhlLocationConnectionByLocationId ?? findGhlLocationConnectionByLocationId;
  const connection = await findConnection(locationId);
  if (!connection || connection.connectionStatus === "revoked") {
    return {
      ok: false,
      error: "No connected GHL OAuth location for this locationId.",
      code: "NOT_CONNECTED",
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;

  if (!input.refresh) {
    const cached = await findLatestGhlLocationConfigSnapshot(locationId);
    if (cached) {
      const fields = detectSa360RequiredCustomFields(
        (cached.customFieldsJson as GhlDiscoveredCustomField[]) ?? []
      );
      const discovery = snapshotToDiscoveryResult(cached, fields);
      assertNoTokensInGhlConfigPayload(discovery as unknown as Record<string, unknown>);
      return { ok: true, discovery };
    }
  }

  const discovery = await fetchDiscoveryLive(locationId, fetchImpl);
  assertNoTokensInGhlConfigPayload(discovery as unknown as Record<string, unknown>);

  await createGhlLocationConfigSnapshot({
    locationId,
    clientAccountId: input.clientAccountId?.trim() || connection.clientAccountId,
    fetchedAt: new Date(discovery.fetchedAt),
    locationName: discovery.location.name,
    locationJson: discovery.location as Prisma.InputJsonValue,
    pipelinesJson: discovery.pipelines as Prisma.InputJsonValue,
    workflowsJson: discovery.workflows as Prisma.InputJsonValue,
    usersJson: discovery.users as Prisma.InputJsonValue,
    customFieldsJson: discovery.customFields as Prisma.InputJsonValue,
    tagsJson: discovery.tags as Prisma.InputJsonValue,
    errorsJson: discovery.errors as Prisma.InputJsonValue,
    warningsJson: discovery.warnings as Prisma.InputJsonValue,
  });

  return { ok: true, discovery };
}

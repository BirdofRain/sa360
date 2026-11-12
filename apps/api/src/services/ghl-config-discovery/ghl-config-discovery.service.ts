import type { Prisma } from "@prisma/client";
import { findGhlLocationConnectionByLocationId } from "../../repositories/ghl-location-connection.repository.js";
import {
  discoveryFailureDetail,
  discoveryFailureSummary,
  dominantSnapshotOutcome,
  explicitDiscoveryCollection,
  failureCodeForSnapshotOutcome,
  type GhlDiscoveryListResource,
  ghlSnapshotMessageStrings,
  ghlSnapshotOutcomeMarker,
  redactGhlDiscoveryText,
  isWellFormedDiscoveredLocation,
  previouslyCapturedSnapshotMessage,
  resourceFailureLine,
  type GhlDiscoveryFailureCode,
  type GhlSnapshotOutcome,
} from "../../lib/ghl-config-snapshot-validity.js";
import {
  createGhlLocationConfigSnapshot,
  findLatestUsableGhlLocationConfigSnapshot,
  findNewestGhlLocationConfigSnapshot,
} from "../../repositories/ghl-location-config-snapshot.repository.js";
import {
  GHL_CONFIG_DISCOVERY_PATHS,
  ghlReadOnlyGet,
  type GhlReadFailureClass,
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

function collectionItems(json: unknown, resource: GhlDiscoveryListResource): unknown[] {
  return explicitDiscoveryCollection(json, resource) ?? [];
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
  const primaryUser = o.primaryUser;
  const primaryRecord =
    primaryUser && typeof primaryUser === "object" && !Array.isArray(primaryUser)
      ? (primaryUser as Record<string, unknown>)
      : null;
  return {
    id: str(o.id) ?? locationId,
    name: str(o.name) ?? str(o.locationName),
    companyId: str(o.companyId),
    timezone: str(o.timezone),
    primaryUserId:
      str(o.primaryUserId) ?? str(o.primary_user_id) ?? str(primaryRecord?.id) ?? str(primaryRecord?.userId),
  };
}

/** @internal Exported for unit tests only. */
export function parsePipelines(json: unknown): GhlDiscoveredPipeline[] {
  return collectionItems(json, "pipelines")
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
  return collectionItems(json, "workflows")
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
  return collectionItems(json, "users")
    .map((item): GhlDiscoveredUser | null => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return null;
      const u = item as Record<string, unknown>;
      const id = str(u.id);
      if (!id) return null;
      const fullName = [str(u.firstName), str(u.lastName)].filter(Boolean).join(" ").trim();
      const name = str(u.name) ?? (fullName || null);
      const roles =
        u.roles && typeof u.roles === "object" && !Array.isArray(u.roles)
          ? (u.roles as Record<string, unknown>)
          : {};
      const locationIds = [roles.locationIds, u.locationIds]
        .flatMap((value) => (Array.isArray(value) ? value : []))
        .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
        .map((value) => value.trim());
      const role = str(u.role) ?? str(roles.role);
      return {
        id,
        name: name ?? id,
        email: str(u.email),
        role,
        userType: str(u.type) ?? str(roles.type),
        locationIds,
        isPrimary: u.isPrimary === true || u.primary === true || role?.toLowerCase() === "owner",
      };
    })
    .filter((user): user is GhlDiscoveredUser => user !== null);
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
  return collectionItems(json, "customFields")
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
  return collectionItems(json, "tags")
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

type ResourceName = "location" | "pipelines" | "workflows" | "users" | "customFields" | "tags";

type ResourceFailure = {
  resource: ResourceName;
  failureClass: GhlReadFailureClass;
  providerDetail: string | null;
};

type LiveDiscovery = {
  discovery: GhlConfigDiscoveryResult;
  outcome: GhlSnapshotOutcome;
  failures: ResourceFailure[];
};

function emptyLocation(locationId: string): GhlDiscoveredLocation {
  return { id: locationId, name: null, companyId: null, timezone: null, primaryUserId: null };
}

function failedResource(
  resource: ResourceName,
  failureClass: GhlReadFailureClass | null,
  providerDetail: string | null
): ResourceFailure {
  return { resource, failureClass: failureClass ?? "http_error", providerDetail };
}

async function readResource(
  locationId: string,
  resource: ResourceName,
  path: string,
  query: Record<string, string> | undefined,
  fetchImpl: typeof fetch
): Promise<{ ok: true; json: unknown } | ResourceFailure> {
  const result = await ghlReadOnlyGet(locationId, path, query, fetchImpl);
  if (!result.ok) return failedResource(resource, result.failureClass, result.errorMessage);
  if (resource === "location") {
    if (!isWellFormedDiscoveredLocation(result.json, locationId)) {
      return failedResource(resource, "malformed", result.errorMessage);
    }
    return { ok: true, json: result.json };
  }
  if (!explicitDiscoveryCollection(result.json, resource)) {
    return failedResource(resource, "malformed", result.errorMessage);
  }
  return { ok: true, json: result.json };
}

async function fetchDiscoveryLive(
  locationId: string,
  fetchImpl: typeof fetch
): Promise<LiveDiscovery> {
  const trimmed = locationId.trim();
  const query = { locationId: trimmed };
  const failures: ResourceFailure[] = [];

  const locationRead = await readResource(
    trimmed,
    "location",
    GHL_CONFIG_DISCOVERY_PATHS.location(trimmed),
    undefined,
    fetchImpl
  );
  const location = "ok" in locationRead ? parseLocation(locationRead.json, trimmed) : emptyLocation(trimmed);
  if (!("ok" in locationRead)) failures.push(locationRead);

  const pipelinesRead = await readResource(
    trimmed,
    "pipelines",
    GHL_CONFIG_DISCOVERY_PATHS.pipelines,
    query,
    fetchImpl
  );
  const pipelines = "ok" in pipelinesRead ? parsePipelines(pipelinesRead.json) : [];
  if (!("ok" in pipelinesRead)) failures.push(pipelinesRead);

  const workflowsRead = await readResource(
    trimmed,
    "workflows",
    GHL_CONFIG_DISCOVERY_PATHS.workflows,
    query,
    fetchImpl
  );
  const workflows = "ok" in workflowsRead ? parseWorkflows(workflowsRead.json) : [];
  if (!("ok" in workflowsRead)) failures.push(workflowsRead);

  const usersRead = await readResource(trimmed, "users", GHL_CONFIG_DISCOVERY_PATHS.users, query, fetchImpl);
  const users = "ok" in usersRead ? parseUsers(usersRead.json) : [];
  if (!("ok" in usersRead)) failures.push(usersRead);

  const fieldsRead = await readResource(
    trimmed,
    "customFields",
    GHL_CONFIG_DISCOVERY_PATHS.customFields(trimmed),
    undefined,
    fetchImpl
  );
  const customFields = "ok" in fieldsRead ? parseCustomFields(fieldsRead.json) : [];
  if (!("ok" in fieldsRead)) failures.push(fieldsRead);

  const tagsRead = await readResource(
    trimmed,
    "tags",
    GHL_CONFIG_DISCOVERY_PATHS.tags(trimmed),
    undefined,
    fetchImpl
  );
  const tags = "ok" in tagsRead ? parseTags(tagsRead.json) : [];
  if (!("ok" in tagsRead)) failures.push(tagsRead);

  const outcome: GhlSnapshotOutcome =
    failures.length === 0 ? "complete" : dominantSnapshotOutcome(failures.map((failure) => failure.failureClass), 6);
  const requiredFields = detectSa360RequiredCustomFields(customFields);
  const discovery: GhlConfigDiscoveryResult = {
    location,
    pipelines,
    workflows,
    users,
    customFields,
    tags,
    fetchedAt: new Date().toISOString(),
    fromCache: false,
    snapshotVerification: outcome === "complete" ? "live" : "cached",
    warnings: [],
    errors: failures.map((failure) =>
      resourceFailureLine(failure.resource, failure.failureClass, failure.providerDetail)
    ),
    requiredFields,
    sa360FieldMapping: buildSa360FieldMappingDiscoveryReport(customFields),
  };
  return { discovery, outcome, failures };
}

export type DiscoverGhlLocationConfigDeps = {
  findGhlLocationConnectionByLocationId?: typeof findGhlLocationConnectionByLocationId;
};

export type DiscoverGhlLocationConfigResult =
  | { ok: true; discovery: GhlConfigDiscoveryResult }
  | {
      ok: false;
      error: string;
      code: "NOT_CONNECTED" | "NOT_FOUND" | GhlDiscoveryFailureCode;
      preservedSnapshot: GhlConfigDiscoveryResult | null;
    };

export async function discoverGhlLocationConfig(
  input: {
    locationId: string;
    refresh?: boolean;
    clientAccountId?: string | null;
    fetchImpl?: typeof fetch;
  },
  deps: DiscoverGhlLocationConfigDeps = {}
): Promise<DiscoverGhlLocationConfigResult> {
  const locationId = input.locationId.trim();
  if (!locationId) {
    return { ok: false, error: "locationId is required.", code: "NOT_FOUND", preservedSnapshot: null };
  }

  const findConnection =
    deps.findGhlLocationConnectionByLocationId ?? findGhlLocationConnectionByLocationId;
  const connection = await findConnection(locationId);
  if (!connection || connection.connectionStatus === "revoked") {
    return {
      ok: false,
      error: "No connected GHL OAuth location for this locationId.",
      code: "NOT_CONNECTED",
      preservedSnapshot: null,
    };
  }

  const fetchImpl = input.fetchImpl ?? fetch;
  const clientAccountId = input.clientAccountId?.trim() || connection.clientAccountId;

  if (!input.refresh) {
    const loaded = await loadStoredDiscovery(locationId);
    if (loaded) return loaded;
  }

  const live = await fetchDiscoveryLive(locationId, fetchImpl);
  const summary =
    live.outcome === "complete"
      ? null
      : discoveryFailureSummary({
          outcome: live.outcome,
          providerDetail: live.failures.find((failure) => failure.providerDetail)?.providerDetail ?? null,
        });
  const storedErrors = summary ? [summary, ...live.discovery.errors] : live.discovery.errors;
  assertNoTokensInGhlConfigPayload({ ...live.discovery, errors: storedErrors } as unknown as Record<string, unknown>);
  await createGhlLocationConfigSnapshot({
    locationId,
    clientAccountId,
    fetchedAt: new Date(live.discovery.fetchedAt),
    locationName: live.discovery.location.name,
    locationJson: live.discovery.location as Prisma.InputJsonValue,
    pipelinesJson: live.discovery.pipelines as Prisma.InputJsonValue,
    workflowsJson: live.discovery.workflows as Prisma.InputJsonValue,
    usersJson: live.discovery.users as Prisma.InputJsonValue,
    customFieldsJson: live.discovery.customFields as Prisma.InputJsonValue,
    tagsJson: live.discovery.tags as Prisma.InputJsonValue,
    errorsJson: [ghlSnapshotOutcomeMarker(live.outcome), ...storedErrors] as Prisma.InputJsonValue,
    warningsJson: live.discovery.warnings as Prisma.InputJsonValue,
  });

  if (live.outcome === "complete") {
    assertNoTokensInGhlConfigPayload(live.discovery as unknown as Record<string, unknown>);
    return { ok: true, discovery: live.discovery };
  }

  const preserved = await presentUsableSnapshot(locationId, summary);
  const code = failureCodeForSnapshotOutcome(live.outcome);
  return {
    ok: false,
    code,
    error: `${summary}${discoveryFailureDetail(Boolean(preserved))}`,
    preservedSnapshot: preserved,
  };
}

async function loadStoredDiscovery(locationId: string): Promise<DiscoverGhlLocationConfigResult | null> {
  const newest = await findNewestGhlLocationConfigSnapshot(locationId);
  if (!newest) return null;
  const usable = await findLatestUsableGhlLocationConfigSnapshot(locationId);
  if (!usable) {
    const summary = storedFailureSummary(newest.errorsJson);
    return {
      ok: false,
      code: "NO_USABLE_SNAPSHOT",
      error: `No usable GoHighLevel snapshot is stored for this location. The latest refresh failed: ${summary}`,
      preservedSnapshot: null,
    };
  }
  const superseded = newest.id !== usable.id;
  const summary = superseded ? storedFailureSummary(newest.errorsJson) : null;
  const discovery = presentSnapshot(usable, superseded ? "previously_captured" : "cached", summary);
  return { ok: true, discovery };
}

async function presentUsableSnapshot(
  locationId: string,
  failureSummary: string | null
): Promise<GhlConfigDiscoveryResult | null> {
  const usable = await findLatestUsableGhlLocationConfigSnapshot(locationId);
  if (!usable) return null;
  return presentSnapshot(usable, "previously_captured", failureSummary);
}

function storedFailureSummary(errorsJson: unknown): string {
  const redacted = redactGhlDiscoveryText(
    ghlSnapshotMessageStrings(errorsJson)[0] ?? "The latest GoHighLevel discovery did not succeed."
  );
  return redacted || "The latest GoHighLevel discovery did not succeed.";
}

function presentSnapshot(
  row: NonNullable<Awaited<ReturnType<typeof findLatestUsableGhlLocationConfigSnapshot>>>,
  verification: GhlConfigDiscoveryResult["snapshotVerification"],
  failureSummary: string | null
): GhlConfigDiscoveryResult {
  const fields = detectSa360RequiredCustomFields((row.customFieldsJson as GhlDiscoveredCustomField[]) ?? []);
  const discovery = snapshotToDiscoveryResult(row, fields);
  discovery.snapshotVerification = verification;
  if (verification === "previously_captured") {
    discovery.errors = [
      previouslyCapturedSnapshotMessage(
        failureSummary ?? "The latest GoHighLevel discovery did not succeed."
      ),
    ];
  }
  assertNoTokensInGhlConfigPayload(discovery as unknown as Record<string, unknown>);
  return discovery;
}

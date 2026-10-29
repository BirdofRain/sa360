/**
 * Creates missing TEXT contact fields on Sam's Test only.
 * Existing money Coverage Amount is not reused or changed.
 * This does not write a client field map and does not call any other location.
 */
import { getGhlOAuthApiBaseUrl } from "../../lib/ghl-oauth-env.js";
import { getGhlWorkspaceSyncTimeoutMs } from "../../lib/ghl-workspace-sync-env.js";
import { resolveGhlBearerAuthForLocation } from "../ghl-oauth/ghl-auth-resolver.service.js";

export const SAM_TEST_GHL_LOCATION_ID = "yCziKRW26eFg8IXAQZ73";
export const CREATE_SAM_TEST_SURVEY_TEXT_FIELDS = "CREATE SAM TEST SURVEY TEXT FIELDS";
const GHL_VERSION = "2021-07-28";

export const SAM_TEST_SURVEY_TEXT_FIELD_SPECS = [
  { sourceAttribute: "primary_reason", name: "Primary Reason" },
  { sourceAttribute: "marital_status", name: "Marital Status" },
  { sourceAttribute: "military_status", name: "Military Status" },
  { sourceAttribute: "branch_of_service", name: "Branch of Service" },
  { sourceAttribute: "sex", name: "Sex" },
  { sourceAttribute: "best_time_to_call", name: "Best Time to Call" },
  { sourceAttribute: "desired_coverage", name: "Desired Coverage Range" },
] as const;

export type SamTestSurveyAttribute = (typeof SAM_TEST_SURVEY_TEXT_FIELD_SPECS)[number]["sourceAttribute"];

export type SurveyCustomField = {
  id: string;
  name: string;
  key: string | null;
  fieldKey: string | null;
  dataType: string | null;
  model: string | null;
};

export type SurveyFieldPlanItem = {
  sourceAttribute: SamTestSurveyAttribute;
  name: string;
  action: "reuse" | "create";
  id: string | null;
  fieldKey: string | null;
};

type EnsureDeps = {
  fetchImpl?: typeof fetch;
  resolveAuth?: (locationId: string) => Promise<{ token: string } | null>;
  apiBase?: string;
  timeoutMs?: number;
};

export type EnsuredSurveyField = {
  sourceAttribute: SamTestSurveyAttribute;
  name: string;
  id: string;
  fieldKey: string | null;
  dataType: "TEXT";
  created: boolean;
};

export function planSamTestSurveyTextFields(existing: readonly SurveyCustomField[]): SurveyFieldPlanItem[] {
  return SAM_TEST_SURVEY_TEXT_FIELD_SPECS.map((spec) => {
    const match = bestCompatibleField(spec.sourceAttribute, spec.name, existing);
    return {
      sourceAttribute: spec.sourceAttribute,
      name: spec.name,
      action: match ? "reuse" : "create",
      id: match?.id ?? null,
      fieldKey: match?.fieldKey ?? match?.key ?? null,
    };
  });
}

export async function ensureSamTestSurveyTextFields(
  locationId: string,
  deps: EnsureDeps = {}
): Promise<
  | { ok: true; locationId: string; fields: EnsuredSurveyField[] }
  | { ok: false; code: "location_not_allowed" | "not_connected" | "ghl_error"; error: string }
> {
  if (locationId.trim() !== SAM_TEST_GHL_LOCATION_ID) {
    return { ok: false, code: "location_not_allowed", error: "Survey text fields can be created only on Sam's Test." };
  }
  const resolveAuth = deps.resolveAuth ?? resolveGhlBearerAuthForLocation;
  const auth = await resolveAuth(locationId.trim());
  if (!auth?.token) return { ok: false, code: "not_connected", error: "No GHL OAuth connection for this location." };
  const fetchImpl = deps.fetchImpl ?? fetch;
  const base = (deps.apiBase ?? getGhlOAuthApiBaseUrl()).replace(/\/$/, "");
  const timeoutMs = deps.timeoutMs ?? (getGhlWorkspaceSyncTimeoutMs() || 15_000);
  const path = `/locations/${encodeURIComponent(locationId.trim())}/customFields`;

  const listed = await ghlJson(fetchImpl, `${base}${path}`, auth.token, "GET", undefined, timeoutMs);
  if (!listed.ok) return { ok: false, code: "ghl_error", error: listed.error };
  let fields = parseSurveyFields(listed.json);
  const plan = planSamTestSurveyTextFields(fields);
  const ensured: EnsuredSurveyField[] = [];

  for (const item of plan) {
    if (item.action === "reuse" && item.id) {
      ensured.push({
        sourceAttribute: item.sourceAttribute,
        name: item.name,
        id: item.id,
        fieldKey: item.fieldKey,
        dataType: "TEXT",
        created: false,
      });
      continue;
    }
    const created = await ghlJson(fetchImpl, `${base}${path}`, auth.token, "POST", {
      name: item.name,
      dataType: "TEXT",
      model: "contact",
    }, timeoutMs);
    if (!created.ok) return { ok: false, code: "ghl_error", error: created.error };
    const parsed = parseCreatedField(created.json);
    if (!parsed) return { ok: false, code: "ghl_error", error: `GHL did not return an id for ${item.name}.` };
    if (parsed.dataType && parsed.dataType.toUpperCase() !== "TEXT") {
      return { ok: false, code: "ghl_error", error: `GHL created ${item.name} with type ${parsed.dataType}.` };
    }
    fields = [...fields, parsed];
    ensured.push({
      sourceAttribute: item.sourceAttribute,
      name: parsed.name || item.name,
      id: parsed.id,
      fieldKey: parsed.fieldKey ?? parsed.key,
      dataType: "TEXT",
      created: true,
    });
  }
  return { ok: true, locationId: locationId.trim(), fields: ensured };
}

function bestCompatibleField(
  attribute: SamTestSurveyAttribute,
  preferredName: string,
  existing: readonly SurveyCustomField[]
): SurveyCustomField | null {
  const ranked = existing
    .filter((field) => isTextContact(field) && matchesAttribute(attribute, field))
    .map((field) => ({ field, score: scoreField(preferredName, attribute, field) }))
    .sort((a, b) => b.score - a.score);
  return ranked[0]?.field ?? null;
}

function isTextContact(field: SurveyCustomField): boolean {
  const type = (field.dataType ?? "").trim().toUpperCase();
  if (type !== "TEXT" && type !== "LARGE_TEXT") return false;
  const model = (field.model ?? "contact").trim().toLowerCase();
  return model === "" || model === "contact";
}

function matchesAttribute(attribute: SamTestSurveyAttribute, field: SurveyCustomField): boolean {
  const compact = compactField(field);
  if (!compact) return false;
  if (attribute === "primary_reason") {
    if (compact.includes("motivation") || compact.includes("interest") || compact.includes("primary concern")) return false;
    return compact.includes("primary reason");
  }
  if (attribute === "marital_status") {
    return compact.includes("marital status") || compact === "marital" || compact.endsWith(" marital");
  }
  if (attribute === "military_status") {
    if (compact.includes("branch")) return false;
    return compact.includes("military status");
  }
  if (attribute === "branch_of_service") {
    if (compact.includes("military status")) return false;
    return compact === "branch" || compact.includes("branch of service");
  }
  if (attribute === "sex") {
    if (compact.includes("sexual")) return false;
    return compact === "sex" || compact === "gender" || compact.endsWith(" sex") || compact.endsWith(" gender");
  }
  if (attribute === "best_time_to_call") return compact.includes("best time to call");
  if (compact.includes("coverage amount")) return false;
  return compact.includes("desired coverage") || compact.includes("coverage range");
}

function scoreField(preferredName: string, attribute: SamTestSurveyAttribute, field: SurveyCustomField): number {
  const name = compact(field.name);
  if (name === compact(preferredName)) return 100;
  const key = compact(field.fieldKey ?? field.key ?? "");
  if (key.endsWith(attribute.replace(/_/g, " ")) || key.endsWith(attribute)) return 80;
  if (attribute === "sex" && name === "sex") return 90;
  return 50;
}

function compactField(field: SurveyCustomField): string {
  return [field.name, field.key, field.fieldKey].filter((value): value is string => Boolean(value)).map(compact).join(" ");
}

function compact(value: string): string {
  return value.toLowerCase().replace(/[_./]+/g, " ").replace(/\s+/g, " ").trim();
}

async function ghlJson(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
  method: "GET" | "POST",
  body: Record<string, string> | undefined,
  timeoutMs: number
): Promise<{ ok: true; json: unknown } | { ok: false; error: string }> {
  try {
    const res = await fetchImpl(url, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        Version: GHL_VERSION,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    });
    const text = await res.text();
    let json: unknown = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    return { ok: true, json };
  } catch {
    return { ok: false, error: "GHL request failed" };
  }
}

function parseSurveyFields(json: unknown): SurveyCustomField[] {
  const raw = asArray(json);
  const fields: SurveyCustomField[] = [];
  for (const item of raw) {
    const field = parseField(item);
    if (field) fields.push(field);
  }
  return fields;
}

function parseCreatedField(json: unknown): SurveyCustomField | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) return null;
  const record = json as Record<string, unknown>;
  return parseField(record.customField ?? record.field ?? record);
}

function parseField(item: unknown): SurveyCustomField | null {
  if (!item || typeof item !== "object" || Array.isArray(item)) return null;
  const record = item as Record<string, unknown>;
  const id = typeof record.id === "string" ? record.id.trim() : "";
  if (!id) return null;
  const name = typeof record.name === "string" && record.name.trim() ? record.name.trim() : id;
  return {
    id,
    name,
    key: stringOrNull(record.key),
    fieldKey: stringOrNull(record.fieldKey),
    dataType: stringOrNull(record.dataType),
    model: stringOrNull(record.model),
  };
}

function asArray(json: unknown): unknown[] {
  if (Array.isArray(json)) return json;
  if (!json || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  for (const key of ["customFields", "fields", "data"]) {
    if (Array.isArray(record[key])) return record[key] as unknown[];
  }
  return [];
}

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

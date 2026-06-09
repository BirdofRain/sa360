/**
 * Environment for Agent Workspace → GoHighLevel outbound sync.
 * Secrets are never hardcoded; tokens come from env (optional per-workspace override).
 */

function parseEnabledFlag(raw: string | undefined): boolean {
  if (raw === undefined || raw.trim() === "") {
    return false;
  }
  return ["true", "1", "yes", "y", "on"].includes(raw.trim().toLowerCase());
}

/** When true, POST /actions/what-happened attempts GHL contact updates after local persistence. */
export function isAgentWorkspaceGhlSyncEnabled(): boolean {
  return parseEnabledFlag(process.env.AGENT_WORKSPACE_GHL_SYNC_ENABLED);
}

/**
 * Private Integration Token for GHL workspace sync.
 * Prefer `AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN` so Synthflow lookup can keep using `GHL_PRIVATE_INTEGRATION_TOKEN` alone.
 */
export function getGhlWorkspaceSyncPrivateToken(): string | undefined {
  const a = process.env.AGENT_WORKSPACE_GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  if (a) {
    return a;
  }
  const b = process.env.GHL_PRIVATE_INTEGRATION_TOKEN?.trim();
  if (b) {
    return b;
  }
  /** Some deployments use this name for the LeadConnector private integration token. */
  const c = process.env.GHL_API_KEY?.trim();
  return c || undefined;
}

export function getGhlWorkspaceSyncApiBaseUrl(): string {
  const u = process.env.GHL_API_BASE_URL?.trim();
  if (u) {
    return u.replace(/\/+$/, "");
  }
  return "https://services.leadconnectorhq.com";
}

export function getGhlWorkspaceSyncTimeoutMs(): number {
  const n = Number(process.env.AGENT_WORKSPACE_GHL_SYNC_TIMEOUT_MS);
  if (!Number.isFinite(n) || n <= 0) {
    return 15_000;
  }
  return Math.min(Math.floor(n), 60_000);
}

export function getGhlWorkspaceSyncMaxAttempts(): number {
  const n = Number(process.env.AGENT_WORKSPACE_GHL_SYNC_MAX_ATTEMPTS);
  if (!Number.isFinite(n) || n < 1) {
    return 3;
  }
  return Math.min(Math.floor(n), 8);
}

/**
 * JSON map of SA360 logical custom field keys → GHL custom field **id** (required by PUT /contacts).
 * Example:
 * `{"sa360_lead_uid":"<uuid>","sa360_client_account_id":"<uuid>","sa360_lifecycle_stage":"<uuid>","sa360_routing_status":"<uuid>"}`
 */
export function parseGhlSa360CustomFieldIdMap(): Record<string, string> {
  const raw = process.env.GHL_SA360_CUSTOM_FIELD_IDS_JSON?.trim();
  if (!raw) {
    return {};
  }
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {};
    }
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) {
        out[k.trim()] = v.trim();
      }
    }
    return out;
  } catch {
    return {};
  }
}

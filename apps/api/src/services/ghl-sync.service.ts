import { redactWebhookPayloadForLog } from "@sa360/shared";
import { prisma } from "../lib/db.js";
import { logger } from "../lib/logger.js";
import {
  getGhlWorkspaceSyncApiBaseUrl,
  getGhlWorkspaceSyncMaxAttempts,
  getGhlWorkspaceSyncPrivateToken,
  getGhlWorkspaceSyncTimeoutMs,
  isAgentWorkspaceGhlSyncEnabled,
  parseGhlSa360CustomFieldIdMap,
} from "../lib/ghl-workspace-sync-env.js";
import type { WhatHappenedOutcome } from "../schemas/agent-workspace.schema.js";

const GHL_VERSION = "2021-07-28";

export const SA360_GHL_CUSTOM_FIELD_KEYS = [
  "sa360_lifecycle_stage",
  "sa360_agent_disposition",
  "sa360_appointment_status",
  "sa360_policy_status",
  "sa360_last_outcome_at",
  "sa360_last_outcome_by",
] as const;

export type Sa360GhlCustomFieldKey = (typeof SA360_GHL_CUSTOM_FIELD_KEYS)[number];

export const SA360_GHL_EVENT_TAGS = {
  FIRST_RESPONSE: "SA360::EVENT::FIRST_RESPONSE",
  APPOINTMENT_SET: "SA360::EVENT::APPOINTMENT_SET",
  SALE_LOGGED: "SA360::EVENT::SALE_LOGGED",
} as const;

export const SA360_GHL_STATUS_TAGS = {
  DEAD: "SA360::STATUS::DEAD",
  BAD_NUMBER: "SA360::STATUS::BAD_NUMBER",
  DNC: "SA360::STATUS::DNC",
} as const;

export type GhlHttpDeps = {
  fetch: typeof fetch;
};

const defaultDeps: GhlHttpDeps = { fetch: globalThis.fetch.bind(globalThis) };

export type WhatHappenedGhlSyncInput = {
  clientAccountId: string;
  locationId: string;
  contactIdGhl: string;
  outcome: WhatHappenedOutcome;
  notes?: string;
  metadata?: Record<string, unknown>;
};

export type GhlSyncStepResult = {
  step: string;
  ok: boolean;
  httpStatus?: number;
  detail?: string;
  /** Safe for logs / API response (no secrets). */
  detailRedacted?: string;
};

export type WhatHappenedGhlSyncResult = {
  /** True when `AGENT_WORKSPACE_GHL_SYNC_ENABLED` is on and a token exists (GHL was targeted). */
  attempted: boolean;
  skippedReason?: string;
  finalStatus: "SYNCED" | "FAILED";
  steps: GhlSyncStepResult[];
  summary: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetriableStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function ghlJson(
  deps: GhlHttpDeps,
  method: string,
  url: string,
  token: string,
  options?: { body?: unknown; timeoutMs: number }
): Promise<{ ok: boolean; status: number; json: unknown; text: string }> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    Accept: "application/json",
    Version: GHL_VERSION,
  };
  let bodyStr: string | undefined;
  if (options?.body !== undefined) {
    headers["Content-Type"] = "application/json";
    bodyStr = JSON.stringify(options.body);
  }

  let lastErr: string | undefined;
  const maxAttempts = getGhlWorkspaceSyncMaxAttempts();
  const timeoutMs = options?.timeoutMs ?? getGhlWorkspaceSyncTimeoutMs();

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await deps.fetch(url, {
        method,
        headers,
        body: bodyStr,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text();
      let json: unknown = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      if (!res.ok && isRetriableStatus(res.status) && attempt < maxAttempts) {
        const backoff = 300 * 2 ** (attempt - 1);
        await sleep(Math.min(backoff, 5000));
        continue;
      }
      return { ok: res.ok, status: res.status, json, text: text.slice(0, 4000) };
    } catch (e) {
      lastErr = e instanceof Error ? e.name : "unknown_error";
      if (attempt < maxAttempts) {
        const backoff = 300 * 2 ** (attempt - 1);
        await sleep(Math.min(backoff, 5000));
        continue;
      }
      return { ok: false, status: 0, json: null, text: lastErr ?? "fetch_failed" };
    }
  }
  return { ok: false, status: 0, json: null, text: lastErr ?? "exhausted_retries" };
}

function pickStr(v: unknown): string | undefined {
  if (typeof v === "string" && v.trim()) {
    return v.trim();
  }
  return undefined;
}

/** Build custom field string values + tag add/remove + note from outcome and optional metadata overrides. */
export function buildWhatHappenedGhlPlan(input: WhatHappenedGhlSyncInput): {
  fieldValues: Partial<Record<Sa360GhlCustomFieldKey, string>>;
  tagsToAdd: string[];
  tagsToRemove: string[];
  noteTitle: string;
  noteBody: string;
} {
  const meta = input.metadata ?? {};
  const tagsToAdd: string[] = [];
  const tagsToRemove: string[] = [];

  const addRemoveFromMeta = () => {
    const add = meta.tagsToAdd;
    if (Array.isArray(add)) {
      for (const t of add) {
        if (typeof t === "string" && t.trim()) {
          tagsToAdd.push(t.trim());
        }
      }
    }
    const rem = meta.tagsToRemove;
    if (Array.isArray(rem)) {
      for (const t of rem) {
        if (typeof t === "string" && t.trim()) {
          tagsToRemove.push(t.trim());
        }
      }
    }
  };
  addRemoveFromMeta();

  switch (input.outcome) {
    case "appointment_set":
      tagsToAdd.push(SA360_GHL_EVENT_TAGS.APPOINTMENT_SET);
      break;
    case "sale_logged":
      tagsToAdd.push(SA360_GHL_EVENT_TAGS.SALE_LOGGED);
      break;
    case "not_interested":
      tagsToAdd.push(SA360_GHL_STATUS_TAGS.DEAD);
      break;
    case "wrong_number":
      tagsToAdd.push(SA360_GHL_STATUS_TAGS.BAD_NUMBER);
      break;
    case "no_answer":
    case "connected_no_result":
    case "callback_scheduled":
      tagsToAdd.push(SA360_GHL_EVENT_TAGS.FIRST_RESPONSE);
      break;
    default:
      break;
  }

  if (pickStr(meta.forceDnc) === "true" || pickStr(meta.disposition)?.toLowerCase() === "dnc") {
    tagsToAdd.push(SA360_GHL_STATUS_TAGS.DNC);
  }

  const nowIso = new Date().toISOString();
  const lastBy =
    pickStr(meta.lastOutcomeBy) ??
    pickStr(meta.agentEmail) ??
    pickStr(meta.agentName) ??
    "SA360 Agent Workspace";

  const fieldValues: Partial<Record<Sa360GhlCustomFieldKey, string>> = {
    sa360_agent_disposition: pickStr(meta.sa360_agent_disposition) ?? input.outcome,
    sa360_last_outcome_at: pickStr(meta.sa360_last_outcome_at) ?? nowIso,
    sa360_last_outcome_by: pickStr(meta.sa360_last_outcome_by) ?? lastBy,
  };

  const ls = pickStr(meta.sa360_lifecycle_stage);
  if (ls) {
    fieldValues.sa360_lifecycle_stage = ls;
  } else if (input.outcome === "appointment_set") {
    fieldValues.sa360_lifecycle_stage = "Appointment Set";
  }

  const ap = pickStr(meta.sa360_appointment_status);
  if (ap) {
    fieldValues.sa360_appointment_status = ap;
  } else if (input.outcome === "appointment_set") {
    fieldValues.sa360_appointment_status = "Set";
  }

  const pol = pickStr(meta.sa360_policy_status);
  if (pol) {
    fieldValues.sa360_policy_status = pol;
  } else if (input.outcome === "sale_logged") {
    fieldValues.sa360_policy_status = pickStr(meta.sa360_policy_status_after_sale) ?? "Sale Logged";
  }

  const noteTitle = `SA360 — ${input.outcome.replace(/_/g, " ")}`;
  const noteLines = [
    `Outcome: ${input.outcome}`,
    input.notes?.trim() ? `Notes: ${input.notes.trim()}` : null,
    `Synced at: ${nowIso}`,
  ].filter(Boolean);
  const noteBody = noteLines.join("\n");

  return {
    fieldValues,
    tagsToAdd: [...new Set(tagsToAdd)],
    tagsToRemove: [...new Set(tagsToRemove)],
    noteTitle,
    noteBody,
  };
}

function buildCustomFieldsForPut(
  idMap: Record<string, string>,
  values: Partial<Record<Sa360GhlCustomFieldKey, string>>
): { id: string; key?: string; field_value: string }[] {
  const out: { id: string; key?: string; field_value: string }[] = [];
  for (const key of SA360_GHL_CUSTOM_FIELD_KEYS) {
    const v = values[key];
    if (v === undefined || v === "") {
      continue;
    }
    const id = idMap[key];
    if (!id) {
      continue;
    }
    out.push({ id, field_value: v });
  }
  return out;
}

function extractContactFromGet(json: unknown): Record<string, unknown> | null {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
  }
  const root = json as Record<string, unknown>;
  const c = root.contact;
  if (c && typeof c === "object" && !Array.isArray(c)) {
    return c as Record<string, unknown>;
  }
  return null;
}

/**
 * Sync “What Happened” to GHL: custom fields (when id map env is set), add/remove tags, create note.
 * Does not throw; returns step log + finalStatus for `AgentWorkspaceAction` updates.
 * Opportunity pipeline moves are not implemented (no existing SA360 helper).
 */
export async function runWhatHappenedGhlSync(
  input: WhatHappenedGhlSyncInput,
  deps: GhlHttpDeps = defaultDeps
): Promise<WhatHappenedGhlSyncResult> {
  const steps: GhlSyncStepResult[] = [];

  if (!isAgentWorkspaceGhlSyncEnabled()) {
    return {
      attempted: false,
      skippedReason: "AGENT_WORKSPACE_GHL_SYNC_ENABLED not true",
      finalStatus: "SYNCED",
      steps,
      summary: "GHL sync disabled; local record only.",
    };
  }

  const token = getGhlWorkspaceSyncPrivateToken();
  if (!token) {
    return {
      attempted: true,
      skippedReason: "missing_private_integration_token",
      finalStatus: "FAILED",
      steps,
      summary: "GHL sync enabled but no Private Integration Token env is set.",
    };
  }

  const locationId = input.locationId.trim();
  const contactId = input.contactIdGhl.trim();
  if (!locationId || !contactId) {
    return {
      attempted: true,
      skippedReason: "missing_location_or_contact",
      finalStatus: "FAILED",
      steps,
      summary: "locationId and contactIdGhl are required for GHL sync.",
    };
  }

  const base = getGhlWorkspaceSyncApiBaseUrl();
  const timeoutMs = getGhlWorkspaceSyncTimeoutMs();
  const idMap = parseGhlSa360CustomFieldIdMap();
  const plan = buildWhatHappenedGhlPlan(input);
  const customFields = buildCustomFieldsForPut(idMap, plan.fieldValues);

  let anyFailure = false;

  if (customFields.length > 0) {
    const getUrl = `${base}/contacts/${encodeURIComponent(contactId)}?locationId=${encodeURIComponent(locationId)}`;
    const got = await ghlJson(deps, "GET", getUrl, token, { timeoutMs });
    const contact = extractContactFromGet(got.json);
    if (!got.ok || !contact) {
      anyFailure = true;
      steps.push({
        step: "get_contact_for_custom_fields",
        ok: false,
        httpStatus: got.status,
        detailRedacted: redactSnippet(got.text),
      });
      logger.warn("ghl_workspace_sync", {
        event: "get_contact_failed",
        http_status: got.status,
        contact_suffix: contactId.slice(-4),
      });
    } else {
      const putBody: Record<string, unknown> = {
        locationId,
        firstName: contact.firstName ?? "",
        lastName: contact.lastName ?? "",
        name: contact.name ?? "",
        email: contact.email ?? "",
        phone: contact.phone ?? "",
        tags: Array.isArray(contact.tags) ? contact.tags : [],
        customFields,
      };
      const putUrl = `${base}/contacts/${encodeURIComponent(contactId)}`;
      const put = await ghlJson(deps, "PUT", putUrl, token, { body: putBody, timeoutMs });
      steps.push({
        step: "put_contact_custom_fields",
        ok: put.ok,
        httpStatus: put.status,
        detailRedacted: put.ok ? "ok" : redactSnippet(put.text),
      });
      if (!put.ok) {
        anyFailure = true;
        logger.warn("ghl_workspace_sync", {
          event: "put_contact_failed",
          http_status: put.status,
          contact_suffix: contactId.slice(-4),
        });
      }
    }
  } else {
    steps.push({
      step: "put_contact_custom_fields",
      ok: true,
      detail: "skipped_no_field_ids_or_no_values",
    });
  }

  if (plan.tagsToAdd.length > 0) {
    const url = `${base}/contacts/${encodeURIComponent(contactId)}/tags`;
    const res = await ghlJson(deps, "POST", url, token, {
      body: { tags: plan.tagsToAdd },
      timeoutMs,
    });
    steps.push({
      step: "add_tags",
      ok: res.ok,
      httpStatus: res.status,
      detailRedacted: res.ok ? `tags=${plan.tagsToAdd.join(",")}` : redactSnippet(res.text),
    });
    if (!res.ok) {
      anyFailure = true;
      logger.warn("ghl_workspace_sync", { event: "add_tags_failed", http_status: res.status });
    }
  }

  if (plan.tagsToRemove.length > 0) {
    const url = `${base}/contacts/${encodeURIComponent(contactId)}/tags`;
    const res = await ghlJson(deps, "DELETE", url, token, {
      body: { tags: plan.tagsToRemove },
      timeoutMs,
    });
    steps.push({
      step: "remove_tags",
      ok: res.ok,
      httpStatus: res.status,
      detailRedacted: res.ok ? `removed=${plan.tagsToRemove.join(",")}` : redactSnippet(res.text),
    });
    if (!res.ok) {
      anyFailure = true;
      logger.warn("ghl_workspace_sync", { event: "remove_tags_failed", http_status: res.status });
    }
  }

  {
    const url = `${base}/contacts/${encodeURIComponent(contactId)}/notes`;
    const res = await ghlJson(deps, "POST", url, token, {
      body: {
        body: plan.noteBody,
        title: plan.noteTitle,
      },
      timeoutMs,
    });
    steps.push({
      step: "create_note",
      ok: res.ok,
      httpStatus: res.status,
      detailRedacted: res.ok ? "note_created" : redactSnippet(res.text),
    });
    if (!res.ok) {
      anyFailure = true;
      logger.warn("ghl_workspace_sync", { event: "create_note_failed", http_status: res.status });
    }
  }

  steps.push({
    step: "opportunity_stage",
    ok: true,
    detail: "skipped_no_opportunity_helper_in_sa360",
  });

  const finalStatus = anyFailure ? "FAILED" : "SYNCED";
  const summary = anyFailure
    ? "One or more GHL API steps failed; see steps for HTTP details."
    : "GHL contact updated (fields/tags/notes per configuration).";

  return {
    attempted: true,
    skippedReason: undefined,
    finalStatus,
    steps,
    summary,
  };
}

function redactSnippet(text: string): string {
  const r = redactWebhookPayloadForLog({ message: text }) as { message?: string };
  const s = typeof r?.message === "string" ? r.message : String(text).slice(0, 500);
  return s.length > 500 ? `${s.slice(0, 500)}…` : s;
}

/**
 * After local `AgentWorkspaceAction` + `ContactGuidanceEvent` rows exist, run GHL sync and patch action status/response.
 */
export async function finalizeWhatHappenedGhlSync(args: {
  actionId: string;
  clientAccountId: string;
  locationId: string;
  contactIdGhl?: string | null;
  outcome: WhatHappenedOutcome;
  notes?: string;
  metadata?: Record<string, unknown>;
  deps?: GhlHttpDeps;
}): Promise<WhatHappenedGhlSyncResult> {
  const contactId = args.contactIdGhl?.trim();
  if (!contactId) {
    const skipped: WhatHappenedGhlSyncResult = {
      attempted: false,
      skippedReason: "contactIdGhl_required_for_ghl",
      finalStatus: "SYNCED",
      steps: [],
      summary: "GHL sync skipped (no GHL contact id on payload).",
    };
    await prisma.agentWorkspaceAction.update({
      where: { id: args.actionId },
      data: {
        status: "SYNCED",
        errorSummary: null,
        responseJson: redactWebhookPayloadForLog({
          recorded: true,
          ghlSync: skipped,
        }) as object,
      },
    });
    return skipped;
  }

  const sync = await runWhatHappenedGhlSync(
    {
      clientAccountId: args.clientAccountId,
      locationId: args.locationId,
      contactIdGhl: contactId,
      outcome: args.outcome,
      notes: args.notes,
      metadata: args.metadata,
    },
    args.deps ?? defaultDeps
  );

  await prisma.agentWorkspaceAction.update({
    where: { id: args.actionId },
    data: {
      status: sync.finalStatus,
      errorSummary:
        sync.finalStatus === "FAILED"
          ? sync.summary.slice(0, 2000)
          : null,
      responseJson: redactWebhookPayloadForLog({
        recorded: true,
        ghlSync: {
          attempted: sync.attempted,
          skippedReason: sync.skippedReason,
          finalStatus: sync.finalStatus,
          summary: sync.summary,
          steps: sync.steps,
        },
      }) as object,
    },
  });

  return sync;
}

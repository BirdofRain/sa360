import { logger } from "../lib/logger.js";
import {
  getGhlApiBaseUrl,
  getGhlContactSearchTimeoutMs,
  getGhlLocationId,
  getGhlPrivateIntegrationToken,
  isGhlContactLookupConfigured,
  isGhlContactLookupEnabled,
} from "../lib/ghl-contact-lookup-env.js";

export type GhlContactSearchSummary = {
  contactIdGhl: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  state: string;
  assignedAgentName: string;
  lifecycleStage: string;
  appointmentStatus: string;
  policyStatus: string;
};

export type GhlContactSearchResult =
  | { kind: "skipped" }
  | { kind: "not_found" }
  | { kind: "matched"; contact: GhlContactSearchSummary }
  | { kind: "error" };

function pickStr(v: unknown): string {
  if (typeof v === "string") {
    return v;
  }
  if (v === null || v === undefined) {
    return "";
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    return String(v);
  }
  return "";
}

function extractContactsArray(json: unknown): unknown[] {
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return [];
  }
  const root = json as Record<string, unknown>;
  if (Array.isArray(root.contacts)) {
    return root.contacts;
  }
  const data = root.data;
  if (data && typeof data === "object" && !Array.isArray(data)) {
    const d = data as Record<string, unknown>;
    if (Array.isArray(d.contacts)) {
      return d.contacts;
    }
  }
  return [];
}

function parseContact(raw: unknown): GhlContactSearchSummary | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }
  const c = raw as Record<string, unknown>;
  const id = pickStr(c.id ?? c.contactId);
  if (!id) {
    return null;
  }

  const firstName = pickStr(c.firstName ?? c.first_name);
  const lastName = pickStr(c.lastName ?? c.last_name);
  const email = pickStr(c.email);

  const addr = c.address;
  let state = "";
  if (addr && typeof addr === "object" && !Array.isArray(addr)) {
    state = pickStr((addr as Record<string, unknown>).state);
  }
  if (!state) {
    state = pickStr(c.state);
  }

  let assignedAgentName = "";
  const at = c.assignedTo;
  if (typeof at === "string") {
    assignedAgentName = at;
  } else if (at && typeof at === "object" && !Array.isArray(at)) {
    assignedAgentName = pickStr(
      (at as Record<string, unknown>).name ??
        (at as Record<string, unknown>).fullName ??
        (at as Record<string, unknown>).firstName
    );
  }

  const rec = c as Record<string, unknown>;
  const lifecycleStage = pickStr(
    c.lifecycleStage ?? c.lifecycle_stage ?? rec["Lifecycle Stage"]
  );
  const appointmentStatus = pickStr(
    c.appointmentStatus ?? c.appointment_status ?? rec["Appointment Status"]
  );
  const policyStatus = pickStr(
    c.policyStatus ?? c.policy_status ?? rec["Policy Status"]
  );

  const displayName = [firstName, lastName].filter(Boolean).join(" ").trim();

  return {
    contactIdGhl: id,
    firstName,
    lastName,
    displayName,
    email,
    state,
    assignedAgentName,
    lifecycleStage,
    appointmentStatus,
    policyStatus,
  };
}

function firstMatchingContact(contacts: unknown[]): GhlContactSearchSummary | null {
  for (const row of contacts) {
    const parsed = parseContact(row);
    if (parsed && (parsed.contactIdGhl || parsed.firstName || parsed.lastName || parsed.displayName)) {
      return parsed;
    }
  }
  return null;
}

/**
 * POST /contacts/search (HighLevel API v2) using Private Integration Token.
 * Does not throw: returns {@link GhlContactSearchResult} for all outcomes.
 */
export async function searchGhlContactByPhone(phoneE164: string): Promise<GhlContactSearchResult> {
  if (!isGhlContactLookupEnabled() || !isGhlContactLookupConfigured()) {
    return { kind: "skipped" };
  }

  const token = getGhlPrivateIntegrationToken()!;
  const locationId = getGhlLocationId()!;
  const base = getGhlApiBaseUrl();
  const timeoutMs = getGhlContactSearchTimeoutMs();

  const url = `${base}/contacts/search`;

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        locationId,
        pageLimit: 20,
        query: phoneE164,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      logger.warn("ghl_contact_search", {
        event: "http_error",
        status: response.status,
      });
      return { kind: "error" };
    }

    const contacts = extractContactsArray(body);
    const match = firstMatchingContact(contacts);

    if (!match) {
      return { kind: "not_found" };
    }

    return { kind: "matched", contact: match };
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    logger.warn("ghl_contact_search", {
      event: "request_failed",
      error_name: name,
    });
    return { kind: "error" };
  }
}

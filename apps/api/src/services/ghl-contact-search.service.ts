import { logger } from "../lib/logger.js";
import {
  getGhlApiBaseUrl,
  getGhlContactSearchTimeoutMs,
  getGhlLocationId,
  getGhlPrivateIntegrationToken,
  isGhlContactLookupConfigured,
  isGhlContactLookupEnabled,
} from "../lib/ghl-contact-lookup-env.js";
import { normalizeToE164 } from "./phone-e164.service.js";

export type GhlContactSearchSummary = {
  contactIdGhl: string;
  firstName: string;
  lastName: string;
  displayName: string;
  email: string;
  /** Internal comparison field only — not exposed in admin duplicate-search responses. */
  phone: string;
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

export type GhlIdentitySearchType = "phone" | "email";

export type GhlIdentitySearchOutcome =
  | "not_found"
  | "matched"
  | "ambiguous"
  | "error"
  | "unverifiable";

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

function extractContactsArray(json: unknown): unknown[] | null {
  if (json === null || json === undefined) {
    return null;
  }
  if (!json || typeof json !== "object" || Array.isArray(json)) {
    return null;
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
  const phone = pickStr(
    c.phone ?? c.phoneNumber ?? c.phone_number ?? c.phoneE164 ?? c.phone_e164
  );

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
    phone,
    state,
    assignedAgentName,
    lifecycleStage,
    appointmentStatus,
    policyStatus,
  };
}

export function normalizeEmailForExactMatch(value: string): string {
  return value.trim().toLowerCase();
}

export function phonesMatchExactly(queryPhone: string, contactPhone: string): boolean {
  const normalizedQuery = normalizeToE164(queryPhone);
  const normalizedContact = normalizeToE164(contactPhone);
  if (!normalizedQuery || !normalizedContact) {
    return false;
  }
  return normalizedQuery === normalizedContact;
}

export function emailsMatchExactly(queryEmail: string, contactEmail: string): boolean {
  const normalizedQuery = normalizeEmailForExactMatch(queryEmail);
  const normalizedContact = normalizeEmailForExactMatch(contactEmail);
  if (!normalizedQuery || !normalizedContact) {
    return false;
  }
  return normalizedQuery === normalizedContact;
}

function contactMatchesIdentity(
  contact: GhlContactSearchSummary,
  query: string,
  identityType: GhlIdentitySearchType
): boolean {
  if (identityType === "phone") {
    if (!contact.phone.trim()) return false;
    return phonesMatchExactly(query, contact.phone);
  }
  if (!contact.email.trim()) return false;
  return emailsMatchExactly(query, contact.email);
}

function findExactIdentityMatches(
  contacts: unknown[],
  query: string,
  identityType: GhlIdentitySearchType
): GhlContactSearchSummary[] {
  const matches: GhlContactSearchSummary[] = [];
  for (const row of contacts) {
    const parsed = parseContact(row);
    if (!parsed) continue;
    if (contactMatchesIdentity(parsed, query, identityType)) {
      matches.push(parsed);
    }
  }
  return matches;
}

export type GhlLocationContactSearchInput = {
  locationId: string;
  accessToken: string;
  query: string;
  identityType: GhlIdentitySearchType;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type GhlLocationContactSearchResult =
  | { kind: "not_found"; matchCount: 0 }
  | { kind: "matched"; contact: GhlContactSearchSummary; matchCount: 1 }
  | { kind: "ambiguous"; matchCount: number }
  | { kind: "error" }
  | { kind: "unverifiable" };

export function toIdentitySearchOutcome(
  result: GhlLocationContactSearchResult
): GhlIdentitySearchOutcome {
  return result.kind;
}

/**
 * POST /contacts/search at an explicit GHL location using a caller-supplied access token.
 * Read-only: does not mutate GHL state. Does not throw.
 */
export async function searchGhlContactsAtLocation(
  input: GhlLocationContactSearchInput
): Promise<GhlLocationContactSearchResult> {
  const locationId = input.locationId.trim();
  const accessToken = input.accessToken.trim();
  const query = input.query.trim();
  if (!locationId || !accessToken || !query) {
    return { kind: "error" };
  }

  const base = getGhlApiBaseUrl();
  const timeoutMs = input.timeoutMs ?? getGhlContactSearchTimeoutMs();
  const fetchImpl = input.fetchImpl ?? fetch;
  const url = `${base}/contacts/search`;

  try {
    const response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
        Version: "2021-07-28",
      },
      body: JSON.stringify({
        locationId,
        pageLimit: 20,
        query,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });

    const body = (await response.json().catch(() => null)) as unknown;

    if (!response.ok) {
      logger.warn("ghl_contact_search", {
        event: "http_error",
        status: response.status,
        scoped: "location",
      });
      return { kind: "error" };
    }

    const contacts = extractContactsArray(body);
    if (contacts === null) {
      return { kind: "unverifiable" };
    }

    const matches = findExactIdentityMatches(contacts, query, input.identityType);
    if (matches.length === 0) {
      return { kind: "not_found", matchCount: 0 };
    }
    if (matches.length === 1) {
      return { kind: "matched", contact: matches[0]!, matchCount: 1 };
    }
    return { kind: "ambiguous", matchCount: matches.length };
  } catch (err) {
    const name = err instanceof Error ? err.name : "unknown";
    logger.warn("ghl_contact_search", {
      event: "request_failed",
      error_name: name,
      scoped: "location",
    });
    return { kind: "error" };
  }
}

/**
 * POST /contacts/search (HighLevel API v2) using Private Integration Token.
 * Does not throw: returns {@link GhlContactSearchResult} for all outcomes.
 */
export async function searchGhlContactByPhone(phoneE164: string): Promise<GhlContactSearchResult> {
  if (!isGhlContactLookupEnabled() || !isGhlContactLookupConfigured()) {
    return { kind: "skipped" };
  }

  const result = await searchGhlContactsAtLocation({
    locationId: getGhlLocationId()!,
    accessToken: getGhlPrivateIntegrationToken()!,
    query: phoneE164,
    identityType: "phone",
  });

  if (result.kind === "not_found") {
    return { kind: "not_found" };
  }
  if (result.kind === "matched") {
    return { kind: "matched", contact: result.contact };
  }
  return { kind: "error" };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function trimString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function firstNonEmpty(...values: unknown[]): string | null {
  for (const value of values) {
    const trimmed = trimString(value);
    if (trimmed) return trimmed;
  }
  return null;
}

function splitName(name: string | null): { firstName: string | null; lastName: string | null } {
  if (!name) return { firstName: null, lastName: null };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return { firstName: null, lastName: null };
  if (parts.length === 1) return { firstName: parts[0] ?? null, lastName: null };
  return {
    firstName: parts[0] ?? null,
    lastName: parts.slice(1).join(" ") || null,
  };
}

export type RoutingLeadIdentitySnapshot = {
  leadName: string | null;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  contactIdGhl: string | null;
};

/**
 * Normalizes lead identity for routing dry-run decisions from lifecycle-like payloads,
 * source normalized payloads, and attribution snapshots.
 */
export function normalizeRoutingLeadIdentity(payload: unknown): RoutingLeadIdentitySnapshot | null {
  const root = asRecord(payload);
  if (!root) return null;

  const routing = asRecord(root.routing);
  const contact = asRecord(root.contact);
  const nestedSnapshot = asRecord(root.leadIdentity);
  const raw = asRecord(root.raw) ?? asRecord(routing?.raw);
  const flat = root;
  const snapshot = nestedSnapshot ?? flat;

  const firstName =
    firstNonEmpty(
      snapshot.firstName,
      snapshot.first_name,
      contact?.first_name,
      contact?.firstName
    ) ?? null;
  const lastName =
    firstNonEmpty(
      snapshot.lastName,
      snapshot.last_name,
      contact?.last_name,
      contact?.lastName
    ) ?? null;

  const combinedName = [firstName, lastName].filter(Boolean).join(" ").trim() || null;
  const explicitName = firstNonEmpty(
    snapshot.leadName,
    snapshot.displayName,
    snapshot.full_name,
    snapshot.fullName,
    snapshot.name,
    snapshot.lead_name,
    contact?.full_name,
    contact?.fullName,
    contact?.name,
    contact?.lead_name
  );
  const rawName = firstNonEmpty(raw?.client_name, raw?.clientName, raw?.name);
  const leadName = explicitName ?? combinedName ?? rawName ?? null;

  const phone = firstNonEmpty(
    snapshot.phone,
    snapshot.phoneE164,
    snapshot.phone_e164,
    snapshot.phone_raw,
    contact?.phone_e164,
    contact?.phoneE164,
    contact?.phone,
    contact?.phone_raw,
    raw?.phone
  );
  const email = firstNonEmpty(snapshot.email, contact?.email, raw?.email);
  const contactIdGhl = firstNonEmpty(
    snapshot.contactIdGhl,
    snapshot.contact_id_ghl,
    contact?.contact_id_ghl,
    contact?.contactIdGhl
  );

  let resolvedFirstName = firstName;
  let resolvedLastName = lastName;
  if ((!resolvedFirstName || !resolvedLastName) && leadName) {
    const split = splitName(leadName);
    resolvedFirstName = resolvedFirstName ?? split.firstName;
    resolvedLastName = resolvedLastName ?? split.lastName;
  }

  if (!leadName && !resolvedFirstName && !resolvedLastName && !phone && !email && !contactIdGhl) {
    return null;
  }

  return {
    leadName: leadName ?? null,
    firstName: resolvedFirstName ?? null,
    lastName: resolvedLastName ?? null,
    phone: phone ?? null,
    email: email ?? null,
    contactIdGhl: contactIdGhl ?? null,
  };
}

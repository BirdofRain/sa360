import type { PrismaClient } from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { prisma } from "../../lib/db.js";
import { resolveGhlAccessTokenForLocation } from "../ghl-oauth/ghl-location-token.service.js";
import { searchGhlContactsAtLocation } from "../ghl-contact-search.service.js";

export type Lf2GhlDuplicateSearchClassification =
  | "no_duplicate_found"
  | "existing_contact_safe_for_reviewed_update"
  | "duplicate_risk"
  | "unable_to_verify";

export type Lf2GhlDuplicateSearchResult =
  | { ok: true; summary: Lf2GhlDuplicateSearchSummary }
  | { ok: false; error: "source_lead_not_found" };

export type Lf2GhlDuplicateSearchSummary = {
  sourceLeadEventId: string;
  clientAccountId: string | null;
  destinationSubaccountIdGhl: string | null;
  classification: Lf2GhlDuplicateSearchClassification;
  phonePresent: boolean;
  emailPresent: boolean;
  phoneSearchAttempted: boolean;
  emailSearchAttempted: boolean;
  matchCount: number | null;
  matchedContactIdGhl: string | null;
  reasonCode: string | null;
};

export type Lf2GhlDuplicateSearchDeps = {
  resolveAccessToken?: typeof resolveGhlAccessTokenForLocation;
  searchContacts?: typeof searchGhlContactsAtLocation;
  findSourceLeadEventById?: typeof findSourceLeadEventById;
  findClientAccountById?: typeof findClientAccountById;
};

function unable(
  partial: Omit<Lf2GhlDuplicateSearchSummary, "classification"> & { reasonCode: string }
): Lf2GhlDuplicateSearchSummary {
  return {
    ...partial,
    classification: "unable_to_verify",
  };
}

export async function runLf2GhlDuplicateSearchForSourceLead(
  sourceLeadEventId: string,
  db: PrismaClient = prisma,
  deps: Lf2GhlDuplicateSearchDeps = {}
): Promise<Lf2GhlDuplicateSearchResult> {
  const resolveAccessToken = deps.resolveAccessToken ?? resolveGhlAccessTokenForLocation;
  const searchContacts = deps.searchContacts ?? searchGhlContactsAtLocation;
  const loadSourceLead = deps.findSourceLeadEventById ?? findSourceLeadEventById;
  const loadClientAccount = deps.findClientAccountById ?? findClientAccountById;

  const event = await loadSourceLead(sourceLeadEventId, db);
  if (!event) {
    return { ok: false, error: "source_lead_not_found" };
  }

  const identity = readNormalizedLeadIdentity(event.normalizedPayloadJson);
  const phone = identity?.phoneE164 ?? null;
  const email = identity?.email ?? null;
  const clientAccountId = event.clientAccountIdResolved?.trim() || null;

  const baseSummary = {
    sourceLeadEventId: event.id,
    clientAccountId,
    destinationSubaccountIdGhl: null as string | null,
    phonePresent: Boolean(phone),
    emailPresent: Boolean(email),
    phoneSearchAttempted: false,
    emailSearchAttempted: false,
    matchCount: null as number | null,
    matchedContactIdGhl: null as string | null,
    reasonCode: null as string | null,
  };

  if (!phone && !email) {
    return {
      ok: true,
      summary: unable({ ...baseSummary, reasonCode: "missing_identity" }),
    };
  }

  if (!clientAccountId) {
    return {
      ok: true,
      summary: unable({ ...baseSummary, reasonCode: "missing_client_account" }),
    };
  }

  const client = await loadClientAccount(clientAccountId, db);
  const destinationSubaccountIdGhl = client?.ghlDestination?.destinationSubaccountIdGhl?.trim() || null;
  baseSummary.destinationSubaccountIdGhl = destinationSubaccountIdGhl;

  if (!destinationSubaccountIdGhl) {
    return {
      ok: true,
      summary: unable({ ...baseSummary, reasonCode: "missing_destination" }),
    };
  }

  let accessToken: string;
  try {
    const auth = await resolveAccessToken(destinationSubaccountIdGhl);
    if (!auth?.accessToken?.trim()) {
      return {
        ok: true,
        summary: unable({ ...baseSummary, reasonCode: "missing_connection" }),
      };
    }
    accessToken = auth.accessToken;
  } catch {
    return {
      ok: true,
      summary: unable({ ...baseSummary, reasonCode: "connection_unusable" }),
    };
  }

  const searchAtLocation = (query: string) =>
    searchContacts({
      locationId: destinationSubaccountIdGhl,
      accessToken,
      query,
    });

  if (phone) {
    baseSummary.phoneSearchAttempted = true;
    const phoneResult = await searchAtLocation(phone);
    if (phoneResult.kind === "matched") {
      return {
        ok: true,
        summary: {
          ...baseSummary,
          classification: "existing_contact_safe_for_reviewed_update",
          matchCount: 1,
          matchedContactIdGhl: phoneResult.contact.contactIdGhl,
          reasonCode: "phone_match_found",
        },
      };
    }
    if (phoneResult.kind === "ambiguous") {
      return {
        ok: true,
        summary: unable({
          ...baseSummary,
          matchCount: phoneResult.matchCount,
          reasonCode: "ambiguous_phone_matches",
        }),
      };
    }
    if (phoneResult.kind === "error") {
      return {
        ok: true,
        summary: unable({ ...baseSummary, reasonCode: "phone_search_failed" }),
      };
    }
  }

  if (email) {
    baseSummary.emailSearchAttempted = true;
    const emailResult = await searchAtLocation(email);
    if (emailResult.kind === "matched") {
      return {
        ok: true,
        summary: {
          ...baseSummary,
          classification: "existing_contact_safe_for_reviewed_update",
          matchCount: 1,
          matchedContactIdGhl: emailResult.contact.contactIdGhl,
          reasonCode: "email_match_found",
        },
      };
    }
    if (emailResult.kind === "ambiguous") {
      return {
        ok: true,
        summary: unable({
          ...baseSummary,
          matchCount: emailResult.matchCount,
          reasonCode: "ambiguous_email_matches",
        }),
      };
    }
    if (emailResult.kind === "error") {
      return {
        ok: true,
        summary: unable({ ...baseSummary, reasonCode: "email_search_failed" }),
      };
    }
  }

  return {
    ok: true,
    summary: {
      ...baseSummary,
      classification: "no_duplicate_found",
      matchCount: 0,
      reasonCode: "authoritative_search_not_found",
    },
  };
}

import type { PrismaClient } from "@prisma/client";

import { readNormalizedLeadIdentity } from "../../lib/normalized-lead-identity.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import { findSourceLeadEventById } from "../../repositories/source-lead-event.repository.js";
import { prisma } from "../../lib/db.js";
import { resolveGhlAccessTokenForLocation } from "../ghl-oauth/ghl-location-token.service.js";
import {
  searchGhlContactsAtLocation,
  toIdentitySearchOutcome,
  type GhlIdentitySearchOutcome,
  type GhlLocationContactSearchResult,
} from "../ghl-contact-search.service.js";

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
  phoneSearchOutcome: GhlIdentitySearchOutcome | null;
  emailSearchOutcome: GhlIdentitySearchOutcome | null;
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

function isUnverifiableLeg(result: GhlLocationContactSearchResult): boolean {
  return result.kind === "error" || result.kind === "unverifiable";
}

function matchedContactId(result: GhlLocationContactSearchResult): string | null {
  return result.kind === "matched" ? result.contact.contactIdGhl : null;
}

function reconcileDualIdentitySearch(input: {
  phoneResult: GhlLocationContactSearchResult;
  emailResult: GhlLocationContactSearchResult;
  baseSummary: Omit<
    Lf2GhlDuplicateSearchSummary,
    "classification" | "reasonCode" | "matchedContactIdGhl" | "phoneSearchOutcome" | "emailSearchOutcome"
  >;
}): Lf2GhlDuplicateSearchSummary {
  const { phoneResult, emailResult, baseSummary } = input;
  const phoneOutcome = toIdentitySearchOutcome(phoneResult);
  const emailOutcome = toIdentitySearchOutcome(emailResult);

  if (isUnverifiableLeg(phoneResult)) {
    return unable({
      ...baseSummary,
      phoneSearchOutcome: phoneOutcome,
      emailSearchOutcome: emailOutcome,
      matchedContactIdGhl: null,
      reasonCode: "phone_search_unverifiable",
    });
  }
  if (isUnverifiableLeg(emailResult)) {
    return unable({
      ...baseSummary,
      phoneSearchOutcome: phoneOutcome,
      emailSearchOutcome: emailOutcome,
      matchedContactIdGhl: null,
      reasonCode: "email_search_unverifiable",
    });
  }
  if (phoneResult.kind === "ambiguous") {
    return unable({
      ...baseSummary,
      phoneSearchOutcome: phoneOutcome,
      emailSearchOutcome: emailOutcome,
      matchedContactIdGhl: null,
      reasonCode: "ambiguous_phone_matches",
    });
  }
  if (emailResult.kind === "ambiguous") {
    return unable({
      ...baseSummary,
      phoneSearchOutcome: phoneOutcome,
      emailSearchOutcome: emailOutcome,
      matchedContactIdGhl: null,
      reasonCode: "ambiguous_email_matches",
    });
  }

  const phoneContactId = matchedContactId(phoneResult);
  const emailContactId = matchedContactId(emailResult);

  if (!phoneContactId && !emailContactId) {
    return {
      ...baseSummary,
      phoneSearchOutcome: phoneOutcome,
      emailSearchOutcome: emailOutcome,
      classification: "no_duplicate_found",
      matchedContactIdGhl: null,
      reasonCode: "authoritative_search_not_found",
    };
  }

  if (phoneContactId && emailContactId) {
    if (phoneContactId === emailContactId) {
      return {
        ...baseSummary,
        phoneSearchOutcome: phoneOutcome,
        emailSearchOutcome: emailOutcome,
        classification: "existing_contact_safe_for_reviewed_update",
        matchedContactIdGhl: phoneContactId,
        reasonCode: "phone_and_email_match_same_contact",
      };
    }
    return {
      ...baseSummary,
      phoneSearchOutcome: phoneOutcome,
      emailSearchOutcome: emailOutcome,
      classification: "duplicate_risk",
      matchedContactIdGhl: null,
      reasonCode: "identity_matches_different_contacts",
    };
  }

  return {
    ...baseSummary,
    phoneSearchOutcome: phoneOutcome,
    emailSearchOutcome: emailOutcome,
    classification: "duplicate_risk",
    matchedContactIdGhl: null,
    reasonCode: "partial_identity_match",
  };
}

function reconcileSingleIdentitySearch(input: {
  result: GhlLocationContactSearchResult;
  baseSummary: Omit<
    Lf2GhlDuplicateSearchSummary,
    "classification" | "reasonCode" | "matchedContactIdGhl" | "phoneSearchOutcome" | "emailSearchOutcome"
  >;
  ambiguousReasonCode: string;
  unverifiableReasonCode: string;
  matchedReasonCode: string;
  identityOutcomeKey: "phoneSearchOutcome" | "emailSearchOutcome";
}): Lf2GhlDuplicateSearchSummary {
  const outcome = toIdentitySearchOutcome(input.result);

  if (isUnverifiableLeg(input.result)) {
    return unable({
      ...input.baseSummary,
      phoneSearchOutcome: input.identityOutcomeKey === "phoneSearchOutcome" ? outcome : null,
      emailSearchOutcome: input.identityOutcomeKey === "emailSearchOutcome" ? outcome : null,
      matchedContactIdGhl: null,
      reasonCode: input.unverifiableReasonCode,
    });
  }
  if (input.result.kind === "ambiguous") {
    return unable({
      ...input.baseSummary,
      phoneSearchOutcome: input.identityOutcomeKey === "phoneSearchOutcome" ? outcome : null,
      emailSearchOutcome: input.identityOutcomeKey === "emailSearchOutcome" ? outcome : null,
      matchedContactIdGhl: null,
      reasonCode: input.ambiguousReasonCode,
    });
  }
  if (input.result.kind === "matched") {
    return {
      ...input.baseSummary,
      phoneSearchOutcome: input.identityOutcomeKey === "phoneSearchOutcome" ? outcome : null,
      emailSearchOutcome: input.identityOutcomeKey === "emailSearchOutcome" ? outcome : null,
      classification: "existing_contact_safe_for_reviewed_update",
      matchedContactIdGhl: input.result.contact.contactIdGhl,
      reasonCode: input.matchedReasonCode,
    };
  }

  return {
    ...input.baseSummary,
    phoneSearchOutcome: input.identityOutcomeKey === "phoneSearchOutcome" ? outcome : null,
    emailSearchOutcome: input.identityOutcomeKey === "emailSearchOutcome" ? outcome : null,
    classification: "no_duplicate_found",
    matchedContactIdGhl: null,
    reasonCode: "authoritative_search_not_found",
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
    phoneSearchOutcome: null as GhlIdentitySearchOutcome | null,
    emailSearchOutcome: null as GhlIdentitySearchOutcome | null,
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

  const searchAtLocation = (query: string, identityType: "phone" | "email") =>
    searchContacts({
      locationId: destinationSubaccountIdGhl,
      accessToken,
      query,
      identityType,
    });

  if (phone && email) {
    baseSummary.phoneSearchAttempted = true;
    baseSummary.emailSearchAttempted = true;
    const phoneResult = await searchAtLocation(phone, "phone");
    const emailResult = await searchAtLocation(email, "email");
    return {
      ok: true,
      summary: reconcileDualIdentitySearch({
        phoneResult,
        emailResult,
        baseSummary,
      }),
    };
  }

  if (phone) {
    baseSummary.phoneSearchAttempted = true;
    const phoneResult = await searchAtLocation(phone, "phone");
    return {
      ok: true,
      summary: reconcileSingleIdentitySearch({
        result: phoneResult,
        baseSummary,
        identityOutcomeKey: "phoneSearchOutcome",
        ambiguousReasonCode: "ambiguous_phone_matches",
        unverifiableReasonCode: "phone_search_unverifiable",
        matchedReasonCode: "phone_match_found",
      }),
    };
  }

  baseSummary.emailSearchAttempted = true;
  const emailResult = await searchAtLocation(email!, "email");
  return {
    ok: true,
    summary: reconcileSingleIdentitySearch({
      result: emailResult,
      baseSummary,
      identityOutcomeKey: "emailSearchOutcome",
      ambiguousReasonCode: "ambiguous_email_matches",
      unverifiableReasonCode: "email_search_unverifiable",
      matchedReasonCode: "email_match_found",
    }),
  };
}

import type { Prisma, PrismaClient, SourceFunnel } from "@prisma/client";

import { prisma } from "../../lib/db.js";
import { findClientAccountById } from "../../repositories/client-account.repository.js";
import {
  createSourceFunnel,
  findSourceFunnelById,
  updateSourceFunnelAssociation,
} from "../../repositories/source-funnel.repository.js";
import { assertFacebookCaptureIntakeEnabled } from "./facebook-capture-gate.js";
import {
  FACEBOOK_ASSOCIATION_EXPLANATIONS,
  FACEBOOK_FORM_ASSOCIATION_PROVIDER,
  classifyConfirmedFacebookFormOwners,
  facebookFormProviderFunnelId,
  parseFacebookFormProviderFunnelId,
  readFacebookId,
  type FacebookFormAssociationOutcome,
} from "./facebook-form-association.js";

export type FacebookFormAssociationResolution = {
  outcome: FacebookFormAssociationOutcome;
  clientAccountId: string | null;
  sourceFunnelId: string | null;
  pageId: string | null;
  formId: string | null;
  explanation: string;
};

export class FacebookFormAssociationError extends Error {
  constructor(
    readonly code: "client_not_found" | "association_conflict" | "invalid_facebook_id",
    message: string,
    readonly details: {
      currentClientAccountId?: string | null;
      requestedClientAccountId?: string | null;
    } = {}
  ) {
    super(message);
    this.name = "FacebookFormAssociationError";
  }
}

type AssociationDb = PrismaClient | Prisma.TransactionClient;

function formIdentityResolution(input: {
  pageId: string | null;
  formId: string | null;
  formIdentityStatus: "present" | "missing" | "invalid";
}): FacebookFormAssociationResolution | null {
  if (input.formIdentityStatus === "present" && input.pageId && input.formId) return null;
  const outcome: FacebookFormAssociationOutcome =
    input.formIdentityStatus === "invalid" ? "invalid_form_identity" : "missing_form_identity";
  return {
    outcome,
    clientAccountId: null,
    sourceFunnelId: null,
    pageId: input.pageId,
    formId: input.formId,
    explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS[outcome],
  };
}

export async function resolveFacebookFormAssociation(
  input: {
    pageId: string | null;
    formId: string | null;
    formIdentityStatus: "present" | "missing" | "invalid";
  },
  db: AssociationDb = prisma
): Promise<FacebookFormAssociationResolution> {
  const early = formIdentityResolution(input);
  if (early) return early;
  const pageId = input.pageId!;
  const formId = input.formId!;
  const providerFunnelId = facebookFormProviderFunnelId(pageId, formId);
  const rows = await db.sourceFunnel.findMany({
    where: {
      provider: FACEBOOK_FORM_ASSOCIATION_PROVIDER,
      providerFunnelId,
      associationStatus: "confirmed",
    },
    select: { id: true, originClientAccountId: true },
  });
  const outcome = classifyConfirmedFacebookFormOwners(rows.map((row) => row.originClientAccountId));
  if (outcome === "ambiguous") {
    return {
      outcome,
      clientAccountId: null,
      sourceFunnelId: null,
      pageId,
      formId,
      explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS.ambiguous,
    };
  }
  if (outcome === "unassociated") {
    return {
      outcome,
      clientAccountId: null,
      sourceFunnelId: rows[0]?.id ?? null,
      pageId,
      formId,
      explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS.unassociated,
    };
  }
  const owner = rows.find((row) => row.originClientAccountId?.trim())!;
  return {
    outcome: "associated",
    clientAccountId: owner.originClientAccountId,
    sourceFunnelId: owner.id,
    pageId,
    formId,
    explanation: FACEBOOK_ASSOCIATION_EXPLANATIONS.associated,
  };
}

export type FacebookFormAssociationItem = {
  id: string;
  pageId: string;
  formId: string;
  formName: string | null;
  clientAccountId: string;
  associationStatus: "confirmed";
  providerFunnelId: string;
};

function presentItem(funnel: SourceFunnel): FacebookFormAssociationItem | null {
  const parsed = parseFacebookFormProviderFunnelId(funnel.providerFunnelId);
  if (!parsed || funnel.associationStatus !== "confirmed" || !funnel.originClientAccountId) {
    return null;
  }
  return {
    id: funnel.id,
    pageId: parsed.pageId,
    formId: parsed.formId,
    formName: funnel.observedFunnelName,
    clientAccountId: funnel.originClientAccountId,
    associationStatus: "confirmed",
    providerFunnelId: funnel.providerFunnelId!,
  };
}

/**
 * Confirm exact page+form ownership for an existing client.
 * Does not stamp inventory, rewrite historical source events, or infer a client from the form name.
 * A confirmed association to a different client is a conflict; this slice does not reassign it.
 */
export async function confirmFacebookFormAssociation(input: {
  pageId: string;
  formId: string;
  clientAccountId: string;
  formName?: string | null;
}): Promise<{ created: boolean; ownershipUnchanged: boolean; item: FacebookFormAssociationItem }> {
  assertFacebookCaptureIntakeEnabled();
  const page = readFacebookId(input.pageId);
  const form = readFacebookId(input.formId);
  if (!page.ok || !form.ok) {
    throw new FacebookFormAssociationError(
      "invalid_facebook_id",
      "Page ID and Form ID must be numeric Facebook ID strings."
    );
  }
  const clientAccountId = input.clientAccountId.trim();
  if (!clientAccountId) {
    throw new FacebookFormAssociationError("client_not_found", "Client not found.");
  }
  const client = await findClientAccountById(clientAccountId);
  if (!client) {
    throw new FacebookFormAssociationError("client_not_found", "Client not found.");
  }
  const providerFunnelId = facebookFormProviderFunnelId(page.value, form.value);
  const formName = input.formName?.trim() || null;
  const lockKey = `fb-form:${FACEBOOK_FORM_ASSOCIATION_PROVIDER}:${providerFunnelId}`;

  return prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey}))`;
    const existing = await tx.sourceFunnel.findUnique({
      where: {
        provider_providerFunnelId: {
          provider: FACEBOOK_FORM_ASSOCIATION_PROVIDER,
          providerFunnelId,
        },
      },
    });
    if (existing?.associationStatus === "confirmed" && existing.originClientAccountId) {
      if (existing.originClientAccountId !== client.clientAccountId) {
        throw new FacebookFormAssociationError(
          "association_conflict",
          "This Facebook form is already associated with another client. Historical ownership was not changed.",
          {
            currentClientAccountId: existing.originClientAccountId,
            requestedClientAccountId: client.clientAccountId,
          }
        );
      }
      const itemSource =
        formName && formName !== existing.observedFunnelName
          ? await updateSourceFunnelAssociation(
              existing.id,
              {
                associationStatus: "confirmed",
                suggestedClientAccountId: null,
                originClientAccountId: client.clientAccountId,
                observedFunnelName: formName,
              },
              tx
            )
          : existing;
      const item = presentItem(itemSource);
      if (!item) {
        throw new FacebookFormAssociationError(
          "invalid_facebook_id",
          "Stored Facebook form association could not be read."
        );
      }
      return { created: false, ownershipUnchanged: true, item };
    }

    const funnel = existing
      ? await updateSourceFunnelAssociation(
          existing.id,
          {
            associationStatus: "confirmed",
            suggestedClientAccountId: null,
            originClientAccountId: client.clientAccountId,
            ...(formName ? { observedFunnelName: formName } : {}),
          },
          tx
        )
      : await createSourceFunnel(
          {
            provider: FACEBOOK_FORM_ASSOCIATION_PROVIDER,
            providerFunnelId,
            observedFunnelName: formName,
            associationStatus: "confirmed",
            originClientAccountId: client.clientAccountId,
            suggestedClientAccountId: null,
            firstSeenAt: null,
            lastSeenAt: null,
          },
          tx
        );
    const item = presentItem(funnel);
    if (!item) {
      throw new FacebookFormAssociationError(
        "invalid_facebook_id",
        "Facebook form association could not be stored."
      );
    }
    return { created: !existing, ownershipUnchanged: false, item };
  });
}

export async function listFacebookFormAssociations(input?: {
  limit?: number;
}): Promise<FacebookFormAssociationItem[]> {
  const take = Math.min(Math.max(input?.limit ?? 50, 1), 100);
  const rows = await prisma.sourceFunnel.findMany({
    where: {
      provider: FACEBOOK_FORM_ASSOCIATION_PROVIDER,
      associationStatus: "confirmed",
      providerFunnelId: { startsWith: "fbpage:" },
    },
    orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
    take,
  });
  return rows.flatMap((row) => {
    const item = presentItem(row);
    return item ? [item] : [];
  });
}

export async function getFacebookFormAssociationById(
  id: string
): Promise<FacebookFormAssociationItem | null> {
  const row = await findSourceFunnelById(id);
  if (!row || row.provider !== FACEBOOK_FORM_ASSOCIATION_PROVIDER) return null;
  return presentItem(row);
}

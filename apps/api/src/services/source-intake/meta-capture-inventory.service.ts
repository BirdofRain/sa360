import { prisma } from "../../lib/db.js";
import { isMetaTokenEncryptionConfigured, decryptMetaToken } from "../../lib/meta-token-encryption.js";
import { getMetaWebhookConfig } from "../../lib/meta-webhook.js";
import { isFacebookCaptureIntakeEnabled } from "./facebook-capture-gate.js";
import { readFacebookId } from "./facebook-form-association.js";
import {
  discoverMetaAuthorizedAssets,
  type MetaCaptureDiscovery,
} from "./meta-capture-discovery.service.js";
import {
  reconcileMetaCaptureForms,
  type MetaCaptureReconciliation,
  type MetaFormEvidence,
} from "./meta-capture-reconcile.js";
import { listMetaPageCredentials, type MetaPageCredentialPublic } from "./meta-page-token.service.js";

export function isMetaCaptureInventoryEnabled(): boolean {
  return (process.env.SA360_META_CAPTURE_INVENTORY_ENABLED?.trim() ?? "").toLowerCase() === "true";
}

export type MetaCaptureHealth = {
  flags: {
    intakeEnabled: boolean;
    graphFetchEnabled: boolean;
    routingEnabled: boolean;
    legacyDirectIntakeEnabled: boolean;
    captureAssociationEnabled: boolean;
    unboundPageTokenEnabled: boolean;
    inventoryDiscoveryEnabled: boolean;
    encryptionConfigured: boolean;
    envTokenConfigured: boolean;
    envTokenPageId: string | null;
  };
  credentials: MetaPageCredentialPublic[];
  review: {
    adminReviewUnmatched: number;
    associationDisabled: number;
    captureNotAllowlisted: number;
    candidateForms: number;
  };
};

const REVIEW_OUTCOMES = ["unassociated", "ambiguous", "missing_form_identity", "invalid_form_identity"] as const;

export async function loadMetaCaptureHealth(): Promise<MetaCaptureHealth> {
  const config = getMetaWebhookConfig();
  const [credentials, adminReviewUnmatched, associationDisabled, captureNotAllowlisted, candidateForms] =
    await Promise.all([
      listMetaPageCredentials(),
      countAssociationOutcome([...REVIEW_OUTCOMES]),
      countAssociationOutcome(["association_disabled"]),
      prisma.sourceLeadEvent.count({
        where: {
          sourceProvider: "facebook",
          sourceSystem: "meta_lead_ads",
          status: "received",
          enrichmentMetadataJson: {
            path: ["metaLeadgenFetch", "tokenBlockReason"],
            equals: "capture_not_allowlisted",
          },
        },
      }),
      prisma.metaFormCandidate.count(),
    ]);
  return {
    flags: {
      intakeEnabled: config.intakeEnabled,
      graphFetchEnabled: config.graphFetchEnabled,
      routingEnabled: config.routingEnabled,
      legacyDirectIntakeEnabled: (process.env.FACEBOOK_DIRECT_INTAKE_ENABLED?.trim() ?? "").toLowerCase() === "true",
      captureAssociationEnabled: isFacebookCaptureIntakeEnabled(),
      unboundPageTokenEnabled: config.unboundPageTokenEnabled,
      inventoryDiscoveryEnabled: isMetaCaptureInventoryEnabled(),
      encryptionConfigured: isMetaTokenEncryptionConfigured(),
      envTokenConfigured: Boolean(config.accessToken),
      envTokenPageId: config.accessTokenPageId,
    },
    credentials,
    review: {
      adminReviewUnmatched,
      associationDisabled,
      captureNotAllowlisted,
      candidateForms,
    },
  };
}

async function countAssociationOutcome(outcomes: string[]): Promise<number> {
  const counts = await Promise.all(
    outcomes.map((outcome) =>
      prisma.sourceLeadEvent.count({
        where: {
          sourceProvider: "facebook",
          sourceSystem: "meta_lead_ads",
          clientAccountIdResolved: null,
          status: "normalized",
          enrichmentMetadataJson: {
            path: ["association", "outcome"],
            equals: outcome,
          },
        },
      })
    )
  );
  return counts.reduce((sum, count) => sum + count, 0);
}

export type MetaCandidateInput = {
  pageId: string;
  formId: string;
  pageName?: string | null;
  formName?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adId?: string | null;
  adAccountId?: string | null;
  note?: string | null;
};

export type MetaCandidateImportResult =
  | {
      ok: true;
      sourceLabel: string;
      imported: number;
      updated: number;
      forms: number;
      createsClient: false;
      overwritesConfirmedAssociation: false;
    }
  | { ok: false; error: "invalid_candidate" | "empty_registry" | "candidate_is_not_ownership" };

const SOURCE_LABEL = /^[a-z0-9][a-z0-9._-]{0,79}$/;

export type ParsedMetaCandidateRegistry =
  | { ok: true; sourceLabel: string; rows: MetaCandidateInput[] }
  | { ok: false; error: "invalid_candidate" | "empty_registry" | "candidate_is_not_ownership" };

export function parseMetaCandidateRegistry(body: {
  sourceLabel?: unknown;
  pages?: unknown;
  note?: unknown;
  clientAccountId?: unknown;
  originClientAccountId?: unknown;
}): ParsedMetaCandidateRegistry {
  if ("clientAccountId" in body || "originClientAccountId" in body) {
    return { ok: false, error: "candidate_is_not_ownership" };
  }
  if (typeof body.sourceLabel !== "string" || !SOURCE_LABEL.test(body.sourceLabel)) {
    return { ok: false, error: "invalid_candidate" };
  }
  if (!Array.isArray(body.pages) || body.pages.length === 0) return { ok: false, error: "empty_registry" };
  const rows: MetaCandidateInput[] = [];
  for (const page of body.pages) {
    if (!page || typeof page !== "object") return { ok: false, error: "invalid_candidate" };
    const pageRec = page as Record<string, unknown>;
    const pageId = readFacebookId(pageRec.pageId);
    if (!pageId.ok) return { ok: false, error: "invalid_candidate" };
    const forms = pageRec.forms;
    if (!Array.isArray(forms)) return { ok: false, error: "invalid_candidate" };
    for (const form of forms) {
      if (!form || typeof form !== "object") return { ok: false, error: "invalid_candidate" };
      const formRec = form as Record<string, unknown>;
      if (
        "clientAccountId" in formRec ||
        "originClientAccountId" in formRec ||
        "clientAccountId" in pageRec ||
        "originClientAccountId" in pageRec
      ) {
        return { ok: false, error: "candidate_is_not_ownership" };
      }
      const formId = readFacebookId(formRec.formId);
      if (!formId.ok) return { ok: false, error: "invalid_candidate" };
      rows.push({
        pageId: pageId.value,
        formId: formId.value,
        pageName: textOrNull(pageRec.pageName),
        formName: textOrNull(formRec.formName),
        campaignId: textOrNull(formRec.campaignId),
        campaignName: textOrNull(formRec.campaignName),
        adsetId: textOrNull(formRec.adsetId),
        adId: textOrNull(formRec.adId),
        adAccountId: textOrNull(formRec.adAccountId),
        note: textOrNull(body.note),
      });
    }
  }
  if (rows.length === 0 || rows.length > 200) return { ok: false, error: "invalid_candidate" };
  return { ok: true, sourceLabel: body.sourceLabel, rows };
}

function textOrNull(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 200) : null;
}

export async function importMetaFormCandidates(input: {
  sourceLabel: string;
  rows: MetaCandidateInput[];
}): Promise<Extract<MetaCandidateImportResult, { ok: true }>> {
  let imported = 0;
  let updated = 0;
  await prisma.$transaction(async (tx) => {
    for (const row of input.rows) {
      const existing = await tx.metaFormCandidate.findUnique({
        where: {
          pageId_formId_sourceLabel: {
            pageId: row.pageId,
            formId: row.formId,
            sourceLabel: input.sourceLabel,
          },
        },
        select: { id: true },
      });
      const data = {
        pageName: row.pageName ?? null,
        formName: row.formName ?? null,
        campaignId: row.campaignId ?? null,
        campaignName: row.campaignName ?? null,
        adsetId: row.adsetId ?? null,
        adId: row.adId ?? null,
        adAccountId: row.adAccountId ?? null,
        note: row.note ?? null,
      };
      if (existing) {
        await tx.metaFormCandidate.update({ where: { id: existing.id }, data });
        updated += 1;
      } else {
        await tx.metaFormCandidate.create({
          data: { ...data, pageId: row.pageId, formId: row.formId, sourceLabel: input.sourceLabel },
        });
        imported += 1;
      }
    }
  });
  return {
    ok: true,
    sourceLabel: input.sourceLabel,
    imported,
    updated,
    forms: input.rows.length,
    createsClient: false,
    overwritesConfirmedAssociation: false,
  };
}

export async function loadMetaCaptureInventory(input?: {
  liveCredentialId?: string | null;
  discoverImpl?: typeof discoverMetaAuthorizedAssets;
}): Promise<{
  ok: true;
  reconciliation: MetaCaptureReconciliation[];
  discovery: MetaCaptureDiscovery | null;
  notes: string[];
}> {
  const [candidates, funnels] = await Promise.all([
    prisma.metaFormCandidate.findMany({ take: 500, orderBy: [{ pageId: "asc" }, { formId: "asc" }] }),
    prisma.sourceFunnel.findMany({
      where: { provider: "facebook", providerFunnelId: { startsWith: "fbpage:" } },
      select: {
        id: true,
        providerFunnelId: true,
        originClientAccountId: true,
        suggestedClientAccountId: true,
        observedFunnelName: true,
      },
      take: 1000,
    }),
  ]);
  const evidence: MetaFormEvidence[] = candidates.map((row) => ({
    pageId: row.pageId,
    formId: row.formId,
    formName: row.formName,
    campaignId: row.campaignId,
    campaignName: row.campaignName,
    adsetId: row.adsetId,
    adId: row.adId,
    adAccountId: row.adAccountId,
    origins: ["candidate"],
  }));
  let discovery: MetaCaptureDiscovery | null = null;
  const notes = [
    "Candidate rows and Graph discovery are evidence. They do not create clients or change a confirmed SourceFunnel association.",
    "A CampaignRoutingRule match is not source ownership.",
  ];
  if (input?.liveCredentialId) {
    const credential = await prisma.metaGraphCredential.findUnique({
      where: { id: input.liveCredentialId },
      include: { pageGrants: { select: { pageId: true } } },
    });
    if (!credential) {
      notes.push("The requested credential was not found. Live discovery was skipped.");
    } else if (!isMetaTokenEncryptionConfigured()) {
      notes.push("META_TOKEN_ENCRYPTION_KEY is not configured. Live discovery was skipped.");
    } else {
      let accessToken: string;
      try {
        accessToken = decryptMetaToken(credential.tokenCiphertext);
      } catch {
        notes.push("The stored credential could not be decrypted. Live discovery was skipped. Confirm META_TOKEN_ENCRYPTION_KEY, then retry.");
        accessToken = "";
      }
      if (accessToken) {
        const discover = input.discoverImpl ?? discoverMetaAuthorizedAssets;
        discovery = await discover({
          credentialId: credential.id,
          accessToken,
          appSecret: process.env.META_APP_SECRET?.trim() || null,
          appId: credential.appId ?? process.env.META_APP_ID?.trim() ?? null,
          pageIds: credential.pageGrants.map((grant) => grant.pageId),
        });
        for (const form of discovery.forms.items) {
          evidence.push({
            pageId: form.pageId,
            formId: form.id,
            formName: form.name,
            formStatus: form.status,
            origins: ["graph"],
          });
        }
      }
    }
  } else {
    notes.push("Live Graph discovery is off for this request. Stored grants, candidates, and existing records were reconciled.");
  }
  const formIds = [...new Set(evidence.map((item) => item.formId))];
  const campaignIds = [...new Set(evidence.map((item) => item.campaignId).filter((id): id is string => Boolean(id)))];
  const clientIds = [
    ...new Set(
      funnels.flatMap((funnel) => [funnel.originClientAccountId, funnel.suggestedClientAccountId]).filter((id): id is string => Boolean(id))
    ),
  ];
  const [clients, routingRules] = await Promise.all([
    clientIds.length === 0
      ? Promise.resolve([])
      : prisma.clientAccount.findMany({
          where: { clientAccountId: { in: clientIds } },
          select: { clientAccountId: true, clientDisplayName: true },
        }),
    formIds.length === 0 && campaignIds.length === 0
      ? Promise.resolve([])
      : prisma.campaignRoutingRule.findMany({
          where: {
            active: true,
            OR: [
              ...(formIds.length > 0 ? [{ formId: { in: formIds } }] : []),
              ...(campaignIds.length > 0 ? [{ campaignId: { in: campaignIds } }] : []),
            ],
          },
          select: { id: true, formId: true, campaignId: true, clientAccountId: true, active: true },
          take: 200,
        }),
  ]);
  return {
    ok: true,
    reconciliation: reconcileMetaCaptureForms({ evidence, funnels, clients, routingRules }),
    discovery,
    notes,
  };
}

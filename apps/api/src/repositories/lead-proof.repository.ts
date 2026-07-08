import {
  Prisma,
  type LeadProofArtifactProvider,
  type LeadProofArtifactStatus,
  type LeadProofArtifactType,
  type LeadDuplicateStatus,
  type LeadProofStatus,
  type LeadVerificationStatus,
  type PrismaClient,
} from "@prisma/client";
import { prisma } from "../lib/db.js";

function toNullableJsonInput(
  value: Prisma.InputJsonValue | null | undefined
): Prisma.InputJsonValue | Prisma.NullableJsonNullValueInput | undefined {
  if (value === undefined) return undefined;
  if (value === null) return Prisma.DbNull;
  return value;
}

export type UpsertLeadProofInput = {
  leadUid: string;
  sourceLeadId?: string | null;
  sourceLane?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  campaignId?: string | null;
  campaignName?: string | null;
  adsetId?: string | null;
  adsetName?: string | null;
  adId?: string | null;
  adName?: string | null;
  formId?: string | null;
  formName?: string | null;
  landingPageUrl?: string | null;
  referrerUrl?: string | null;
  consentText?: string | null;
  consentVersion?: string | null;
  consentCapturedAt?: Date | null;
  privacyPolicyVersion?: string | null;
  termsVersion?: string | null;
  submittedAt?: Date | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  phoneRaw?: string | null;
  phoneE164?: string | null;
  email?: string | null;
  proofStatus: LeadProofStatus;
  proofMissingReasons?: Prisma.InputJsonValue | null;
  rawSourcePayload?: Prisma.InputJsonValue | null;
};

export type UpsertLeadSourceSnapshotInput = {
  leadUid: string;
  sourceLane?: string | null;
  sourcePlatform?: string | null;
  sourceType?: string | null;
  sourceLeadId?: string | null;
  sourceAttributes?: Prisma.InputJsonValue | null;
  routingAttributes?: Prisma.InputJsonValue | null;
  rawPayload?: Prisma.InputJsonValue | null;
  capturedAt?: Date;
};

export type UpsertLeadVerificationResultInput = {
  leadUid: string;
  verificationStatus?: LeadVerificationStatus;
  duplicateStatus?: LeadDuplicateStatus | null;
  phoneStatus?: string | null;
  emailStatus?: string | null;
  suppressionStatus?: string | null;
  qualityScore?: number | null;
  reasons?: Prisma.InputJsonValue | null;
  checkedAt?: Date | null;
};

export type UpsertLeadProofArtifactInput = {
  leadProofId: string;
  provider: LeadProofArtifactProvider;
  artifactType: LeadProofArtifactType;
  status?: LeadProofArtifactStatus;
  externalReference?: string | null;
  certificateUrl?: string | null;
  integrityHash?: string | null;
  signature?: string | null;
  algorithm?: string | null;
  keyId?: string | null;
  capturedAt?: Date | null;
  issuedAt?: Date | null;
  verifiedAt?: Date | null;
  retainedAt?: Date | null;
  expiresAt?: Date | null;
  artifactFingerprint: string;
  providerMetadata?: Prisma.InputJsonValue | null;
  failureReasons?: Prisma.InputJsonValue | null;
  rawArtifactPayload?: Prisma.InputJsonValue | null;
};

export async function upsertLeadProof(
  input: UpsertLeadProofInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadProof.upsert({
    where: { leadUid: input.leadUid },
    create: {
      ...input,
      proofMissingReasons: toNullableJsonInput(input.proofMissingReasons),
      rawSourcePayload: toNullableJsonInput(input.rawSourcePayload),
    },
    update: {
      ...input,
      proofMissingReasons: toNullableJsonInput(input.proofMissingReasons),
      rawSourcePayload: toNullableJsonInput(input.rawSourcePayload),
    },
  });
}

export async function getLeadProofByLeadUid(
  leadUid: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadProof.findUnique({ where: { leadUid } });
}

export async function getLeadProofWithArtifactsByLeadUid(
  leadUid: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadProof.findUnique({
    where: { leadUid },
    include: {
      proofArtifacts: {
        orderBy: { createdAt: "asc" },
      },
    },
  });
}

export async function getLeadVerificationResultByLeadUid(
  leadUid: string,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadVerificationResult.findUnique({ where: { leadUid } });
}

export async function upsertLeadSourceSnapshot(
  input: UpsertLeadSourceSnapshotInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  const capturedAt = input.capturedAt ?? new Date();
  return db.leadSourceSnapshot.upsert({
    where: { leadUid: input.leadUid },
    create: {
      leadUid: input.leadUid,
      sourceLane: input.sourceLane ?? null,
      sourcePlatform: input.sourcePlatform ?? null,
      sourceType: input.sourceType ?? null,
      sourceLeadId: input.sourceLeadId ?? null,
      sourceAttributes: toNullableJsonInput(input.sourceAttributes),
      routingAttributes: toNullableJsonInput(input.routingAttributes),
      rawPayload: toNullableJsonInput(input.rawPayload),
      capturedAt,
    },
    update: {
      sourceLane: input.sourceLane ?? null,
      sourcePlatform: input.sourcePlatform ?? null,
      sourceType: input.sourceType ?? null,
      sourceLeadId: input.sourceLeadId ?? null,
      sourceAttributes: toNullableJsonInput(input.sourceAttributes),
      routingAttributes: toNullableJsonInput(input.routingAttributes),
      rawPayload: toNullableJsonInput(input.rawPayload),
      capturedAt,
    },
  });
}

export async function upsertLeadVerificationResult(
  input: UpsertLeadVerificationResultInput,
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  return db.leadVerificationResult.upsert({
    where: { leadUid: input.leadUid },
    create: {
      leadUid: input.leadUid,
      verificationStatus: input.verificationStatus ?? "UNCHECKED",
      duplicateStatus: input.duplicateStatus ?? null,
      phoneStatus: input.phoneStatus ?? null,
      emailStatus: input.emailStatus ?? null,
      suppressionStatus: input.suppressionStatus ?? null,
      qualityScore: input.qualityScore ?? null,
      reasons: toNullableJsonInput(input.reasons),
      checkedAt: input.checkedAt ?? null,
    },
    update: {
      ...(input.verificationStatus !== undefined &&
      input.verificationStatus !== "UNCHECKED"
        ? { verificationStatus: input.verificationStatus }
        : {}),
      ...(input.duplicateStatus !== undefined && input.duplicateStatus !== "UNCHECKED"
        ? { duplicateStatus: input.duplicateStatus }
        : {}),
      ...(input.phoneStatus !== undefined ? { phoneStatus: input.phoneStatus } : {}),
      ...(input.emailStatus !== undefined ? { emailStatus: input.emailStatus } : {}),
      ...(input.suppressionStatus !== undefined ? { suppressionStatus: input.suppressionStatus } : {}),
      ...(input.qualityScore !== undefined ? { qualityScore: input.qualityScore } : {}),
      ...(input.reasons !== undefined
        ? { reasons: toNullableJsonInput(input.reasons) }
        : {}),
      ...(input.checkedAt !== undefined ? { checkedAt: input.checkedAt } : {}),
    },
  });
}

export async function upsertLeadProofArtifacts(
  inputs: UpsertLeadProofArtifactInput[],
  db: PrismaClient | Prisma.TransactionClient = prisma
) {
  if (inputs.length === 0) return [];
  return Promise.all(
    inputs.map((input) =>
      db.leadProofArtifact.upsert({
        where: {
          leadProofId_artifactFingerprint: {
            leadProofId: input.leadProofId,
            artifactFingerprint: input.artifactFingerprint,
          },
        },
        create: {
          leadProofId: input.leadProofId,
          provider: input.provider,
          artifactType: input.artifactType,
          status: input.status ?? "CAPTURED",
          externalReference: input.externalReference ?? null,
          certificateUrl: input.certificateUrl ?? null,
          integrityHash: input.integrityHash ?? null,
          signature: input.signature ?? null,
          algorithm: input.algorithm ?? null,
          keyId: input.keyId ?? null,
          capturedAt: input.capturedAt ?? null,
          issuedAt: input.issuedAt ?? null,
          verifiedAt: input.verifiedAt ?? null,
          retainedAt: input.retainedAt ?? null,
          expiresAt: input.expiresAt ?? null,
          artifactFingerprint: input.artifactFingerprint,
          providerMetadata: toNullableJsonInput(input.providerMetadata),
          failureReasons: toNullableJsonInput(input.failureReasons),
          rawArtifactPayload: toNullableJsonInput(input.rawArtifactPayload),
        },
        // Preserve first-write payload for stable audit trails.
        update: {},
      })
    )
  );
}

export type LeadProofArtifactSummary = {
  totalArtifacts: number;
  providers: string[];
  hasConsentCertificate: boolean;
  hasCryptographicIntegrity: boolean;
};

export type LeadProofOverviewRecentIntakeRow = {
  leadUid: string;
  sourceLane: string | null;
  sourcePlatform: string | null;
  state: string | null;
  niche: string | null;
  proofStatus: LeadProofStatus;
  verificationStatus: LeadVerificationStatus | null;
  artifactSummary: LeadProofArtifactSummary | null;
  createdAt: Date;
};

export type LeadProofOverviewActivityRow = {
  id: string;
  leadUid: string;
  proofStatus: LeadProofStatus;
  verificationStatus: LeadVerificationStatus | null;
  createdAt: Date;
  updatedAt: Date;
};

export type LeadProofOverviewSummary = {
  totalLeads: number;
  proofStatusCounts: Record<LeadProofStatus, number>;
  verificationStatusCounts: Record<LeadVerificationStatus, number>;
  recentIntake: LeadProofOverviewRecentIntakeRow[];
  recentActivity: LeadProofOverviewActivityRow[];
};

function emptyProofStatusCounts(): Record<LeadProofStatus, number> {
  return {
    UNREVIEWED: 0,
    PROOF_ATTACHED: 0,
    PROOF_MISSING: 0,
    NEEDS_REVIEW: 0,
    REJECTED: 0,
  };
}

function emptyVerificationStatusCounts(): Record<LeadVerificationStatus, number> {
  return {
    UNCHECKED: 0,
    PASSED: 0,
    FAILED: 0,
    NEEDS_REVIEW: 0,
  };
}

function readJsonString(value: unknown, key: string): string | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = (value as Record<string, unknown>)[key];
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

export async function getLeadProofOverviewSummary(
  options?: { recentLimit?: number },
  db: PrismaClient | Prisma.TransactionClient = prisma
): Promise<LeadProofOverviewSummary> {
  const recentLimit = options?.recentLimit ?? 10;

  const [totalLeads, proofGroups, verificationGroups, recentProofRows] = await Promise.all([
    db.leadProof.count(),
    db.leadProof.groupBy({
      by: ["proofStatus"],
      _count: { _all: true },
    }),
    db.leadVerificationResult.groupBy({
      by: ["verificationStatus"],
      _count: { _all: true },
    }),
    db.leadProof.findMany({
      orderBy: { createdAt: "desc" },
      take: recentLimit,
      include: {
        proofArtifacts: {
          select: {
            provider: true,
            artifactType: true,
            status: true,
          },
        },
      },
    }),
  ]);

  const proofStatusCounts = emptyProofStatusCounts();
  for (const group of proofGroups) {
    proofStatusCounts[group.proofStatus] = group._count._all;
  }

  const verificationStatusCounts = emptyVerificationStatusCounts();
  for (const group of verificationGroups) {
    verificationStatusCounts[group.verificationStatus] = group._count._all;
  }

  const leadUids = recentProofRows.map((row) => row.leadUid);
  const [verificationRows, snapshotRows] = await Promise.all([
    leadUids.length > 0
      ? db.leadVerificationResult.findMany({ where: { leadUid: { in: leadUids } } })
      : Promise.resolve([]),
    leadUids.length > 0
      ? db.leadSourceSnapshot.findMany({ where: { leadUid: { in: leadUids } } })
      : Promise.resolve([]),
  ]);

  const verificationByLeadUid = new Map(verificationRows.map((row) => [row.leadUid, row]));
  const snapshotByLeadUid = new Map(snapshotRows.map((row) => [row.leadUid, row]));

  const recentIntake: LeadProofOverviewRecentIntakeRow[] = recentProofRows.map((proof) => {
    const verification = verificationByLeadUid.get(proof.leadUid);
    const snapshot = snapshotByLeadUid.get(proof.leadUid);
    const attrs = snapshot?.sourceAttributes;
    const capturedArtifacts = proof.proofArtifacts.filter((artifact) => artifact.status === "CAPTURED");
    const providers = [...new Set(capturedArtifacts.map((artifact) => artifact.provider))];
    return {
      leadUid: proof.leadUid,
      sourceLane: proof.sourceLane ?? snapshot?.sourceLane ?? null,
      sourcePlatform: proof.sourcePlatform ?? snapshot?.sourcePlatform ?? null,
      state:
        readJsonString(attrs, "state") ??
        readJsonString(attrs, "lead_state") ??
        readJsonString(attrs, "state_code"),
      niche:
        readJsonString(attrs, "niche") ??
        readJsonString(attrs, "niche_key") ??
        readJsonString(snapshot?.routingAttributes, "niche_key"),
      proofStatus: proof.proofStatus,
      verificationStatus: verification?.verificationStatus ?? null,
      artifactSummary:
        capturedArtifacts.length > 0
          ? {
              totalArtifacts: capturedArtifacts.length,
              providers,
              hasConsentCertificate: capturedArtifacts.some(
                (artifact) => artifact.artifactType === "CONSENT_CERTIFICATE"
              ),
              hasCryptographicIntegrity: capturedArtifacts.some(
                (artifact) => artifact.artifactType === "CRYPTOGRAPHIC_INTEGRITY"
              ),
            }
          : null,
      createdAt: proof.createdAt,
    };
  });

  const recentActivity: LeadProofOverviewActivityRow[] = recentProofRows.map((proof) => ({
    id: proof.id,
    leadUid: proof.leadUid,
    proofStatus: proof.proofStatus,
    verificationStatus: verificationByLeadUid.get(proof.leadUid)?.verificationStatus ?? null,
    createdAt: proof.createdAt,
    updatedAt: proof.updatedAt,
  }));

  return {
    totalLeads,
    proofStatusCounts,
    verificationStatusCounts,
    recentIntake,
    recentActivity,
  };
}

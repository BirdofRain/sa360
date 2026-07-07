import type {
  LeadProofArtifactProvider,
  LeadProofArtifactStatus,
  LeadProofArtifactType,
  Prisma,
} from "@prisma/client";

type JsonObject = Prisma.InputJsonObject;

export type ExtractedProofArtifact = {
  provider: LeadProofArtifactProvider;
  artifactType: LeadProofArtifactType;
  status: LeadProofArtifactStatus;
  externalReference: string | null;
  certificateUrl: string | null;
  integrityHash: string | null;
  signature: string | null;
  algorithm: string | null;
  keyId: string | null;
  capturedAt: Date | null;
  issuedAt: Date | null;
  verifiedAt: Date | null;
  retainedAt: Date | null;
  expiresAt: Date | null;
  artifactFingerprint: string;
  providerMetadata: JsonObject | null;
  failureReasons: string[] | null;
  rawArtifactPayload: JsonObject;
};

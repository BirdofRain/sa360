import type { LeadProofArtifactProvider, LeadProofArtifactType, LeadProofStatus } from "@prisma/client";
import type { ExtractedProofArtifact } from "./lead-proof-artifact.types.js";

export type ProofRequirement = {
  artifactType: LeadProofArtifactType;
  providers: LeadProofArtifactProvider[];
};

export type ProofRequirementPolicy = {
  sourceLane: string;
  requiredArtifacts: ProofRequirement[];
};

const PROOF_REQUIREMENT_POLICIES: Record<string, ProofRequirementPolicy> = {
  leadcapture_io: {
    sourceLane: "leadcapture_io",
    requiredArtifacts: [
      {
        artifactType: "CRYPTOGRAPHIC_INTEGRITY",
        providers: ["leadcapture_io"],
      },
    ],
  },
  leadconduit_facebook: {
    sourceLane: "leadconduit_facebook",
    requiredArtifacts: [
      {
        artifactType: "CONSENT_CERTIFICATE",
        providers: ["trustedform"],
      },
    ],
  },
  meta_lead_ads: {
    sourceLane: "meta_lead_ads",
    requiredArtifacts: [],
  },
  manual_direct_demo: {
    sourceLane: "manual_direct_demo",
    requiredArtifacts: [],
  },
  manual_import: {
    sourceLane: "manual_import",
    requiredArtifacts: [],
  },
  csv_import: {
    sourceLane: "csv_import",
    requiredArtifacts: [],
  },
  google_sheet_import: {
    sourceLane: "google_sheet_import",
    requiredArtifacts: [],
  },
  unknown: {
    sourceLane: "unknown",
    requiredArtifacts: [],
  },
};

function normalizeSourceLane(sourceLane: string | null | undefined): string {
  const lane = sourceLane?.trim().toLowerCase();
  if (!lane) return "unknown";
  return lane;
}

function resolvePolicyKey(sourceLane: string | null | undefined): string {
  const lane = normalizeSourceLane(sourceLane);
  if (PROOF_REQUIREMENT_POLICIES[lane]) return lane;
  if (lane.includes("manual")) return "manual_import";
  if (lane.includes("import")) return "manual_import";
  return "unknown";
}

export function getProofRequirementPolicy(sourceLane: string | null | undefined): ProofRequirementPolicy {
  return PROOF_REQUIREMENT_POLICIES[resolvePolicyKey(sourceLane)];
}

function statusSeverity(status: LeadProofStatus): number {
  switch (status) {
    case "REJECTED":
      return 4;
    case "PROOF_MISSING":
      return 3;
    case "NEEDS_REVIEW":
      return 2;
    case "PROOF_ATTACHED":
      return 1;
    case "UNREVIEWED":
    default:
      return 0;
  }
}

function mergeLeadProofStatus(
  baseline: LeadProofStatus,
  artifactRequirementStatus: LeadProofStatus
): LeadProofStatus {
  return statusSeverity(baseline) >= statusSeverity(artifactRequirementStatus)
    ? baseline
    : artifactRequirementStatus;
}

export function applyProofRequirementPolicy(input: {
  sourceLane: string | null;
  baselineStatus: LeadProofStatus;
  baselineMissingReasons: string[];
  baselineMissingFields: string[];
  extractedArtifacts: ExtractedProofArtifact[];
}): {
  proofStatus: LeadProofStatus;
  proofMissingReasons: string[];
  missingProofFields: string[];
} {
  const policy = getProofRequirementPolicy(input.sourceLane);
  if (policy.requiredArtifacts.length === 0) {
    return {
      proofStatus: input.baselineStatus,
      proofMissingReasons: input.baselineMissingReasons,
      missingProofFields: input.baselineMissingFields,
    };
  }

  const missingRequirementMessages: string[] = [];
  const missingRequirementFields: string[] = [];
  for (const requirement of policy.requiredArtifacts) {
    const matchedArtifact = input.extractedArtifacts.some(
      (artifact) =>
        artifact.status === "CAPTURED" &&
        artifact.artifactType === requirement.artifactType &&
        requirement.providers.includes(artifact.provider)
    );
    if (!matchedArtifact) {
      missingRequirementFields.push(`artifact:${requirement.artifactType}`);
      missingRequirementMessages.push(
        `${policy.sourceLane} requires ${requirement.artifactType} artifact before proof can be treated as complete.`
      );
    }
  }

  if (missingRequirementFields.length === 0) {
    return {
      proofStatus: input.baselineStatus,
      proofMissingReasons: input.baselineMissingReasons,
      missingProofFields: input.baselineMissingFields,
    };
  }

  const hasCapturedArtifact = input.extractedArtifacts.some((artifact) => artifact.status === "CAPTURED");
  const requirementStatus: LeadProofStatus = hasCapturedArtifact ? "NEEDS_REVIEW" : "PROOF_MISSING";

  return {
    proofStatus: mergeLeadProofStatus(input.baselineStatus, requirementStatus),
    proofMissingReasons: [...input.baselineMissingReasons, ...missingRequirementMessages],
    missingProofFields: [...input.baselineMissingFields, ...missingRequirementFields],
  };
}

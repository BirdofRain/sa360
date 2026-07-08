import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import type { ExtractedProofArtifact } from "./lead-proof-artifact.types.js";

type JsonObject = Prisma.InputJsonObject;

function asObject(value: unknown): JsonObject | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as JsonObject;
}

function readString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function readDate(value: unknown): Date | null {
  const raw = readString(value);
  if (!raw) return null;
  const ms = Date.parse(raw);
  if (Number.isNaN(ms)) return null;
  return new Date(ms);
}

function firstString(...values: unknown[]): string | null {
  for (const value of values) {
    const str = readString(value);
    if (str) return str;
  }
  return null;
}

function firstDate(...values: unknown[]): Date | null {
  for (const value of values) {
    const parsed = readDate(value);
    if (parsed) return parsed;
  }
  return null;
}

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const cleaned = value
    .map((item) => readString(item))
    .filter((item): item is string => Boolean(item));
  return cleaned.length > 0 ? cleaned : null;
}

function normalizeFingerprintToken(token: string): string {
  return token.trim().toLowerCase().replace(/\/+$/g, "");
}

function buildArtifactFingerprint(...tokens: string[]): string {
  const basis = tokens.map(normalizeFingerprintToken).join("|");
  return createHash("sha256").update(basis).digest("hex");
}

function normalizeCertificateUrl(rawUrl: string): string | null {
  try {
    const parsed = new URL(rawUrl);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return null;
    parsed.hash = "";
    const pathname = parsed.pathname.replace(/\/+$/g, "");
    return `${parsed.protocol}//${parsed.host.toLowerCase()}${pathname}${parsed.search}`;
  } catch {
    return null;
  }
}

function trustedFormArtifactFromPayload(
  root: JsonObject,
  sourceAttributes: JsonObject | null,
  compliance: JsonObject | null,
  capturedAtHint: Date | null
): ExtractedProofArtifact | null {
  const trustedFormCertificateUrlRaw = firstString(
    root.trustedform_cert_url,
    root.trustedformCertUrl,
    root.xxTrustedFormCertUrl,
    root.trustedform_certificate_url,
    sourceAttributes?.trustedform_cert_url,
    sourceAttributes?.trustedformCertUrl,
    sourceAttributes?.xxTrustedFormCertUrl,
    compliance?.trustedform_cert_url,
    compliance?.trustedformCertUrl,
    compliance?.xxTrustedFormCertUrl
  );
  if (!trustedFormCertificateUrlRaw) return null;
  const trustedFormCertificateUrl = normalizeCertificateUrl(trustedFormCertificateUrlRaw);

  const trustFormKey = firstString(
    root.trust_form_key,
    root.trustFormKey,
    sourceAttributes?.trust_form_key,
    sourceAttributes?.trustFormKey,
    compliance?.trust_form_key
  );
  const signature = firstString(
    root.trustedform_signature,
    sourceAttributes?.trustedform_signature,
    compliance?.trustedform_signature
  );
  const algorithm = firstString(
    root.trustedform_algorithm,
    sourceAttributes?.trustedform_algorithm,
    compliance?.trustedform_algorithm
  );
  const keyId = firstString(
    root.trustedform_key_id,
    sourceAttributes?.trustedform_key_id,
    compliance?.trustedform_key_id
  );
  const trustedFormExternalReference = firstString(
    root.trustedform_external_reference,
    root.trustedformExternalReference,
    root.trustedform_reference,
    sourceAttributes?.trustedform_external_reference,
    sourceAttributes?.trustedformExternalReference,
    sourceAttributes?.trustedform_reference,
    compliance?.trustedform_external_reference,
    compliance?.trustedformExternalReference,
    compliance?.trustedform_reference
  );
  const leadgenId = firstString(
    sourceAttributes?.leadgen_id,
    sourceAttributes?.facebook_lead_id,
    compliance?.leadgen_id,
    compliance?.facebook_lead_id
  );
  const deliveryId = firstString(
    sourceAttributes?.delivery_id,
    compliance?.delivery_id,
    root.delivery_id
  );
  const issuedAt = firstDate(
    root.trustedform_issued_at,
    sourceAttributes?.trustedform_issued_at,
    compliance?.trustedform_issued_at
  );
  const verifiedAt = firstDate(
    root.trustedform_verified_at,
    sourceAttributes?.trustedform_verified_at,
    compliance?.trustedform_verified_at
  );
  const retainedAt = firstDate(
    root.trustedform_retained_at,
    sourceAttributes?.trustedform_retained_at,
    compliance?.trustedform_retained_at
  );
  const expiresAt = firstDate(
    root.trustedform_expires_at,
    sourceAttributes?.trustedform_expires_at,
    compliance?.trustedform_expires_at
  );
  const failureReasons =
    readStringArray(root.trustedform_failure_reasons) ??
    readStringArray(sourceAttributes?.trustedform_failure_reasons) ??
    readStringArray(compliance?.trustedform_failure_reasons);

  if (!trustedFormCertificateUrl) {
    return {
      provider: "trustedform",
      artifactType: "CONSENT_CERTIFICATE",
      status: "NEEDS_REVIEW",
      externalReference: trustedFormExternalReference ?? trustedFormCertificateUrlRaw,
      certificateUrl: null,
      integrityHash: null,
      signature,
      algorithm,
      keyId,
      capturedAt: capturedAtHint,
      issuedAt,
      verifiedAt,
      retainedAt,
      expiresAt,
      artifactFingerprint: buildArtifactFingerprint(
        "trustedform",
        "consent_certificate",
        "malformed",
        trustedFormCertificateUrlRaw
      ),
      providerMetadata: {
        malformed_certificate_url: true,
        ...(trustFormKey ? { trust_form_key: trustFormKey } : {}),
        ...(deliveryId ? { delivery_id: deliveryId } : {}),
        ...(leadgenId ? { leadgen_id: leadgenId } : {}),
      },
      failureReasons: [
        ...(failureReasons ?? []),
        "TrustedForm certificate URL malformed; review required.",
      ],
      rawArtifactPayload: {
        trustedform_cert_url: trustedFormCertificateUrlRaw,
        ...(trustedFormExternalReference
          ? { trustedform_external_reference: trustedFormExternalReference }
          : {}),
      },
    };
  }

  return {
    provider: "trustedform",
    artifactType: "CONSENT_CERTIFICATE",
    status: "CAPTURED",
    externalReference: trustedFormExternalReference ?? trustedFormCertificateUrl,
    certificateUrl: trustedFormCertificateUrl,
    integrityHash: null,
    signature,
    algorithm,
    keyId,
    capturedAt: capturedAtHint,
    issuedAt,
    verifiedAt,
    retainedAt,
    expiresAt,
    artifactFingerprint: buildArtifactFingerprint(
      "trustedform",
      "consent_certificate",
      trustedFormCertificateUrl
    ),
    providerMetadata: {
      ...(trustFormKey ? { trust_form_key: trustFormKey } : {}),
      ...(deliveryId ? { delivery_id: deliveryId } : {}),
      ...(leadgenId ? { leadgen_id: leadgenId } : {}),
    },
    failureReasons,
    rawArtifactPayload: {
      trustedform_cert_url: trustedFormCertificateUrl,
      ...(trustedFormExternalReference
        ? { trustedform_external_reference: trustedFormExternalReference }
        : {}),
      ...(trustFormKey ? { trust_form_key: trustFormKey } : {}),
    },
  };
}

function leadCaptureIntegrityArtifactFromPayload(
  root: JsonObject,
  sourceAttributes: JsonObject | null,
  compliance: JsonObject | null,
  capturedAtHint: Date | null
): ExtractedProofArtifact | null {
  const verfiProofUrl = firstString(
    compliance?.verfi_proof_url,
    sourceAttributes?.verfi_proof_url,
    root.verfi_proof_url
  );
  const anuraResponseId = firstString(
    compliance?.anura_response_id,
    sourceAttributes?.anura_response_id,
    root.anura_response_id
  );
  const externalReference = verfiProofUrl ?? anuraResponseId;
  if (!externalReference) return null;

  const artifactSignal = verfiProofUrl ? "verfi_proof_url" : "anura_response_id";
  const leadId = firstString(root.lead_id, sourceAttributes?.lead_id, compliance?.lead_id);
  const anuraResult = firstString(compliance?.anura_result, sourceAttributes?.anura_result, root.anura_result);
  const integrityHash = firstString(
    compliance?.integrity_hash,
    sourceAttributes?.integrity_hash,
    root.integrity_hash
  );
  const signature = firstString(compliance?.signature, sourceAttributes?.signature, root.signature);
  const algorithm = firstString(compliance?.algorithm, sourceAttributes?.algorithm, root.algorithm);
  const keyId = firstString(compliance?.key_id, sourceAttributes?.key_id, root.key_id);
  const issuedAt = firstDate(compliance?.issued_at, sourceAttributes?.issued_at, root.issued_at);
  const verifiedAt = firstDate(
    compliance?.verified_at,
    sourceAttributes?.verified_at,
    root.verified_at
  );
  const retainedAt = firstDate(
    compliance?.retained_at,
    sourceAttributes?.retained_at,
    root.retained_at
  );
  const expiresAt = firstDate(compliance?.expires_at, sourceAttributes?.expires_at, root.expires_at);
  const failureReasons =
    readStringArray(compliance?.failure_reasons) ??
    readStringArray(sourceAttributes?.failure_reasons) ??
    readStringArray(root.failure_reasons);

  return {
    provider: "leadcapture_io",
    artifactType: "CRYPTOGRAPHIC_INTEGRITY",
    status: "CAPTURED",
    externalReference,
    certificateUrl: null,
    integrityHash,
    signature,
    algorithm,
    keyId,
    capturedAt: capturedAtHint,
    issuedAt,
    verifiedAt,
    retainedAt,
    expiresAt,
    artifactFingerprint: buildArtifactFingerprint(
      "leadcapture_io",
      "cryptographic_integrity",
      artifactSignal,
      externalReference
    ),
    providerMetadata: {
      signal: artifactSignal,
      ...(anuraResult ? { anura_result: anuraResult } : {}),
      ...(leadId ? { lead_id: leadId } : {}),
    },
    failureReasons,
    rawArtifactPayload: {
      signal: artifactSignal,
      ...(verfiProofUrl ? { verfi_proof_url: verfiProofUrl } : {}),
      ...(anuraResponseId ? { anura_response_id: anuraResponseId } : {}),
      ...(anuraResult ? { anura_result: anuraResult } : {}),
      ...(leadId ? { lead_id: leadId } : {}),
    },
  };
}

function dedupeArtifacts(artifacts: ExtractedProofArtifact[]): ExtractedProofArtifact[] {
  const seen = new Set<string>();
  return artifacts.filter((artifact) => {
    const key = `${artifact.provider}:${artifact.artifactType}:${artifact.artifactFingerprint}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function extractProofArtifacts(input: {
  payload: unknown;
  sourceLane: string | null;
}): ExtractedProofArtifact[] {
  const root = asObject(input.payload);
  if (!root) return [];

  const routing = asObject(root.routing);
  const sourceIntake = routing ? asObject(routing.source_intake) : null;
  const sourceAttributes = sourceIntake ? asObject(sourceIntake.sourceAttributes) : null;
  const compliance = sourceIntake ? asObject(sourceIntake.compliance) : null;
  const capturedAtHint = firstDate(
    sourceIntake?.submitted_at,
    root.consent_captured_at,
    root.consentCapturedAt,
    root.submitted_at,
    root.submittedAt
  );

  const artifacts: ExtractedProofArtifact[] = [];
  const trustedFormArtifact = trustedFormArtifactFromPayload(
    root,
    sourceAttributes,
    compliance,
    capturedAtHint
  );
  if (trustedFormArtifact) {
    artifacts.push(trustedFormArtifact);
  }

  if (input.sourceLane === "leadcapture_io") {
    const leadCaptureIntegrityArtifact = leadCaptureIntegrityArtifactFromPayload(
      root,
      sourceAttributes,
      compliance,
      capturedAtHint
    );
    if (leadCaptureIntegrityArtifact) {
      artifacts.push(leadCaptureIntegrityArtifact);
    }
  }

  return dedupeArtifacts(artifacts);
}

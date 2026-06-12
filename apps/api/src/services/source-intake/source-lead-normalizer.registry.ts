import type { SourceLeadNormalizer } from "./source-intake.types.js";
import {
  canNormalizeLeadCaptureIoWebhook,
  inferLeadCaptureIoRoutingKeys,
  normalizeLeadCaptureIoWebhookToLifecyclePayload,
} from "./leadcapture-io-normalizer.js";

const leadCaptureIoNormalizer: SourceLeadNormalizer = {
  provider: "leadcapture_io",
  sourceSystem: "leadcapture_io_legacy",
  canNormalize: canNormalizeLeadCaptureIoWebhook,
  normalize: normalizeLeadCaptureIoWebhookToLifecyclePayload,
  inferRoutingKeys: inferLeadCaptureIoRoutingKeys,
};

/** Registered source normalizers — add Meta, GOAT, CSV adapters here. */
export const SOURCE_LEAD_NORMALIZERS: SourceLeadNormalizer[] = [leadCaptureIoNormalizer];

export function findSourceLeadNormalizer(raw: unknown): SourceLeadNormalizer | null {
  for (const normalizer of SOURCE_LEAD_NORMALIZERS) {
    if (normalizer.canNormalize(raw)) {
      return normalizer;
    }
  }
  return null;
}

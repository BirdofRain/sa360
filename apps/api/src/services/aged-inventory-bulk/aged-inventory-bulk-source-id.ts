import { createHash } from "node:crypto";

import { AGED_INVENTORY_BULK_SOURCE_ID_VERSION } from "@sa360/shared";

/**
 * Versioned deterministic content source ID.
 * Includes niche + identity + lead date + name so repeat submissions on different
 * dates remain distinct. Does not include row number, path, file checksum, or chunk.
 */
export function buildAgedBulkSourceLeadId(input: {
  nicheKey: string;
  phoneE164: string | null;
  email: string | null;
  generatedDateIso: string;
  firstName: string;
  lastName: string;
}): string {
  const material = [
    input.nicheKey.trim().toLowerCase(),
    input.phoneE164 ?? "",
    input.email?.trim().toLowerCase() ?? "",
    input.generatedDateIso,
    input.firstName.trim().toLowerCase(),
    input.lastName.trim().toLowerCase(),
  ].join("|");
  const digest = createHash("sha256").update(material, "utf8").digest("hex").slice(0, 24);
  return `${AGED_INVENTORY_BULK_SOURCE_ID_VERSION}-${input.nicheKey.trim().toLowerCase()}-${digest}`;
}

export function maskAgedBulkSourceLeadId(sourceLeadId: string): string {
  if (sourceLeadId.length <= 8) return `${sourceLeadId.slice(0, 2)}***`;
  return `${sourceLeadId.slice(0, 8)}…${sourceLeadId.slice(-4)}`;
}

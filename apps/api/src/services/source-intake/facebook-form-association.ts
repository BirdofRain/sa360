/**
 * Exact Facebook Page ID + Form ID association identity.
 *
 * Stored on the existing SourceFunnel row as provider=facebook and
 * providerFunnelId=`fbpage:{pageId}:fbform:{formId}`. parentUrlKey stays empty
 * because that unique key is one value per provider, and a page has many forms.
 *
 * Campaign and ad overrides are intentionally not part of this key. A later
 * slice can add a more specific rule without changing this exact association.
 */

export const FACEBOOK_FORM_ASSOCIATION_PROVIDER = "facebook" as const;

const FACEBOOK_ID_PATTERN = /^[0-9]{5,32}$/;

export type FacebookIdRead =
  | { ok: true; value: string }
  | { ok: false; code: "missing" | "invalid" | "unsafe_number" };

export type FacebookFormAssociationOutcome =
  | "associated"
  | "unassociated"
  | "ambiguous"
  | "missing_form_identity"
  | "invalid_form_identity"
  | "not_evaluated"
  | "association_disabled";

export const FACEBOOK_ASSOCIATION_EXPLANATIONS = {
  associated:
    "Exact Facebook Page ID and Form ID association matched one client. No delivery was attempted.",
  unassociated:
    "No confirmed Page ID + Form ID association exists. Capture is complete. GHL delivery setup is not required to capture this lead.",
  ambiguous:
    "More than one confirmed client owns this Page ID and Form ID. The lead was captured and left unassigned.",
  missing_form_identity:
    "Page ID and Form ID were not both present, so no client was associated. Capture is complete. GHL delivery setup is not required.",
  invalid_form_identity:
    "The supplied Page ID or Form ID was not a numeric Facebook ID and was not used for association. Capture is complete. GHL delivery setup is not required.",
  not_evaluated:
    "This leadgen_id already has a canonical Facebook event. This intake did not rewrite it, associate it, or start delivery.",
  association_disabled:
    "SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED is not true, so Page ID + Form ID association was not evaluated. Capture is complete and the lead is retained. Enable the flag, then reevaluate this event from Facebook Intake.",
} as const;

export function readFacebookId(value: unknown): FacebookIdRead {
  if (value === undefined || value === null || value === "") {
    return { ok: false, code: "missing" };
  }
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) {
      return { ok: false, code: "unsafe_number" };
    }
    return readFacebookId(String(value));
  }
  if (typeof value !== "string") return { ok: false, code: "invalid" };
  const trimmed = value.trim();
  if (!FACEBOOK_ID_PATTERN.test(trimmed)) return { ok: false, code: "invalid" };
  return { ok: true, value: trimmed };
}

export function facebookFormProviderFunnelId(pageId: string, formId: string): string {
  return `fbpage:${pageId}:fbform:${formId}`;
}

export function parseFacebookFormProviderFunnelId(
  value: string | null | undefined
): { pageId: string; formId: string } | null {
  if (!value) return null;
  const match = /^fbpage:([0-9]{5,32}):fbform:([0-9]{5,32})$/.exec(value.trim());
  if (!match?.[1] || !match[2]) return null;
  return { pageId: match[1], formId: match[2] };
}

/**
 * Active ownership is a confirmed SourceFunnel origin client.
 * More than one distinct owner is ambiguous. Suggestions and form names are ignored.
 */
export function classifyConfirmedFacebookFormOwners(
  originClientAccountIds: Array<string | null | undefined>
): "associated" | "unassociated" | "ambiguous" {
  const owners = [
    ...new Set(
      originClientAccountIds
        .map((id) => (typeof id === "string" ? id.trim() : ""))
        .filter((id) => id.length > 0)
    ),
  ];
  if (owners.length > 1) return "ambiguous";
  if (owners.length === 1) return "associated";
  return "unassociated";
}

export function captureNextAction(outcome: FacebookFormAssociationOutcome): string {
  switch (outcome) {
    case "associated":
      return "Captured and associated to the client. No delivery was attempted.";
    case "ambiguous":
      return "Captured for review. Client association is ambiguous, so the lead was left unassigned.";
    case "not_evaluated":
      return "Existing canonical Facebook lead returned. No delivery was attempted.";
    case "association_disabled":
      return "Captured and retained. Association was skipped because capture-intake writes are disabled; enable SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED and reevaluate.";
    case "invalid_form_identity":
    case "missing_form_identity":
    case "unassociated":
      return "Captured for review. No client association was applied, and that does not block capture.";
  }
}

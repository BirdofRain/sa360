/**
 * Operator UX helpers for the canonical client portalLoginEmail.
 * There is still only one backend field — this module does not introduce another.
 */

export const PORTAL_UNSAVED_EMAIL_INVITE_COPY =
  "Save the login email before generating an invite.";

export const PORTAL_EDIT_LOGIN_EMAIL_LABEL = "Edit login email";
export const PORTAL_CANCEL_LOGIN_EMAIL_LABEL = "Cancel";
export const PORTAL_CURRENT_LOGIN_EMAIL_LABEL = "Current portal login email";
export const PORTAL_NEW_LOGIN_EMAIL_LABEL = "New portal login email";

export function canonicalPortalLoginEmail(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

export function hasUnsavedPortalLoginEmailChange(input: {
  editing: boolean;
  saved: string | null | undefined;
  draft: string;
}): boolean {
  if (!input.editing) return false;
  return canonicalPortalLoginEmail(input.draft) !== canonicalPortalLoginEmail(input.saved);
}

export type PortalSettingsPatch = {
  portalEnabled: boolean;
  portalDisplayName: string | null;
  portalLoginEmail?: string | null;
};

/**
 * Build the admin client patch from the portal-access form.
 * portalLoginEmail is included only when the explicit edit field is present,
 * so a missing input cannot overwrite the saved identity with empty/autofill.
 */
export function buildPortalSettingsPatch(formData: FormData): PortalSettingsPatch {
  const patch: PortalSettingsPatch = {
    portalEnabled: formData.get("portalEnabled") === "on",
    portalDisplayName: String(formData.get("portalDisplayName") ?? "").trim() || null,
  };
  if (!formData.has("portalLoginEmail")) {
    return patch;
  }
  patch.portalLoginEmail = canonicalPortalLoginEmail(String(formData.get("portalLoginEmail") ?? "")) || null;
  return patch;
}

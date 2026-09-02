import { PORTAL_PASSWORD_RESET_GENERIC_SUCCESS } from "@sa360/shared";

export const PORTAL_FORGOT_PASSWORD_TITLE = "Reset your password";
export const PORTAL_FORGOT_PASSWORD_INTRO =
  "Enter the email you use to sign in to the portal. We'll send a reset link if that address is eligible.";
export const PORTAL_FORGOT_PASSWORD_EMAIL_LABEL = "Portal login email";
export const PORTAL_FORGOT_PASSWORD_SUBMIT = "Send reset link";
export const PORTAL_PASSWORD_RESET_GENERIC = PORTAL_PASSWORD_RESET_GENERIC_SUCCESS;
export const PORTAL_FORGOT_PASSWORD_BACK_TO_LOGIN = "Back to sign in";

export function portalForgotPasswordEmailValue(formData: FormData): string {
  return String(formData.get("email") ?? "").trim();
}

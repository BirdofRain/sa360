import { PORTAL_PASSWORD_RESET_TTL_MS } from "./portal-invite-token.js";

export const PORTAL_PASSWORD_RESET_EMAIL_SUBJECT = "Reset your SA360 portal password";
export const PORTAL_PASSWORD_RESET_EXPIRES_MINUTES = PORTAL_PASSWORD_RESET_TTL_MS / (60 * 1000);

export type PortalPasswordResetEmailInput = {
  resetUrl: string;
  expiresMinutes?: number;
};

export function buildPortalPasswordResetEmail(input: PortalPasswordResetEmailInput): {
  subject: string;
  text: string;
  html: string;
} {
  const expiresMinutes = input.expiresMinutes ?? PORTAL_PASSWORD_RESET_EXPIRES_MINUTES;
  const resetUrl = input.resetUrl.trim();
  const subject = PORTAL_PASSWORD_RESET_EMAIL_SUBJECT;
  const text = [
    "We received a request to reset the password for your SA360 portal.",
    "",
    `This link expires in ${expiresMinutes} minutes:`,
    resetUrl,
    "",
    "If you did not request this, you can ignore this email.",
  ].join("\n");
  const html = [
    "<p>We received a request to reset the password for your SA360 portal.</p>",
    `<p>This link expires in ${expiresMinutes} minutes:</p>`,
    `<p><a href="${escapeHtml(resetUrl)}">Reset your portal password</a></p>`,
    "<p>If you did not request this, you can ignore this email.</p>",
  ].join("");
  return { subject, text, html };
}

function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

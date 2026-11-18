/**
 * Recipient-facing SMS disclosure for toll-free verification.
 *
 * v1 and v2 remain valid for rows already stored. Those versions describe
 * webhook acceptance and are not rewritten. New recipient opt-in uses
 * ghl-lead-sms-v1 and refuses to record that consent until both legal URLs
 * are configured. This module does not invent those URLs and does not send.
 */

export const SMS_CONSENT_VERSION_V2 = "external-webhook-sms-v2";
export const SMS_CONSENT_VERSION_GHL = "ghl-lead-sms-v1";
export const SMS_PRIVACY_POLICY_URL_ENV = "SA360_SMS_PRIVACY_POLICY_URL";
export const SMS_TERMS_URL_ENV = "SA360_SMS_TERMS_URL";
export const SMS_OPT_IN_CLIENT_ENV = "SA360_SMS_OPT_IN_CLIENT_ACCOUNT_ID";
export const SMS_OPT_IN_PUBLIC_ORIGIN_ENV = "SA360_SMS_OPT_IN_PUBLIC_ORIGIN";

/** Named SMS consent operators. A mailbox outside this list cannot issue a link or record a verbal note. */
export const SMS_VERBAL_OPERATOR_EMAILS = [
  "matt@lifeagentlaunch.com",
  "alex@lifeagentlaunch.com",
  "aaron@lifeagentlaunch.com",
  "sam@lifeagentlaunch.com",
] as const;

export const SMS_DISCLOSURE = {
  businessName: "Life Agent Launch",
  program: "SA360 Delivery Notifications",
  purpose: "operational notification when a lead is received in your GoHighLevel account",
  frequency: "Message frequency varies.",
  rates: "Message and data rates may apply.",
  stop: "Reply STOP to opt out.",
  help: "Reply HELP for help.",
} as const;

/** Opening sentence stored on external-webhook-sms-v2 rows. Do not change it. */
export const SMS_DISCLOSURE_V2_OPENING =
  "Life Agent Launch may text this number with operational SA360 delivery notifications.";

export const SMS_DISCLOSURE_GHL_OPENING =
  "Life Agent Launch may text this number when a lead is received in your GoHighLevel account.";

const BLOCKED_HOSTS = new Set([
  "localhost",
  "example.com",
  "example.org",
  "example.net",
  "example.test",
]);

export type SmsLegalUrls = {
  privacyPolicyUrl: string;
  termsUrl: string;
};

export type SmsDisclosureView = {
  version: typeof SMS_CONSENT_VERSION_GHL;
  businessName: string;
  program: string;
  purpose: string;
  frequency: string;
  rates: string;
  stop: string;
  help: string;
  privacyPolicyUrl: string | null;
  termsUrl: string | null;
  recordable: boolean;
  text: string | null;
};

/** Public https URL with no user, query, or hash. Null when the value is not usable. */
export function publicLegalUrl(raw: string | undefined): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (value.length < 12 || value.length > 180 || /\s/.test(value)) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== "https:") return null;
  if (url.username || url.password || url.search || url.hash) return null;
  const host = url.hostname.toLowerCase();
  if (!host.includes(".") || host.endsWith(".local") || host.endsWith(".localhost")) return null;
  if (BLOCKED_HOSTS.has(host) || host.endsWith(".example")) return null;
  if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
  if (host === "0.0.0.0" || host.startsWith("127.") || host.startsWith("10.") || host.startsWith("192.168.")) {
    return null;
  }
  const pathname = url.pathname === "/" ? "" : url.pathname.replace(/\/+$/, "");
  if (pathname.includes("..")) return null;
  const normalized = `${url.origin}${pathname}`;
  if (normalized.length > 180) return null;
  return normalized;
}

export function readSmsLegalUrls(env: NodeJS.ProcessEnv = process.env): SmsLegalUrls | null {
  const privacyPolicyUrl = publicLegalUrl(env[SMS_PRIVACY_POLICY_URL_ENV]);
  const termsUrl = publicLegalUrl(env[SMS_TERMS_URL_ENV]);
  if (!privacyPolicyUrl || !termsUrl || privacyPolicyUrl === termsUrl) return null;
  return { privacyPolicyUrl, termsUrl };
}

/** Exact v2 sentence. Stored rows stay on this text. New opt-in does not use it. */
export function composeSmsConsentText(urls: SmsLegalUrls): string {
  return joinDisclosure(SMS_DISCLOSURE_V2_OPENING, urls);
}

export function composeGhlLeadSmsConsentText(urls: SmsLegalUrls): string {
  return joinDisclosure(SMS_DISCLOSURE_GHL_OPENING, urls);
}

function joinDisclosure(opening: string, urls: SmsLegalUrls): string {
  return [
    opening,
    SMS_DISCLOSURE.frequency,
    SMS_DISCLOSURE.rates,
    SMS_DISCLOSURE.stop,
    SMS_DISCLOSURE.help,
    `Privacy Policy: ${urls.privacyPolicyUrl}`,
    `Terms: ${urls.termsUrl}`,
  ].join(" ");
}

const V2_TEXT =
  /^Life Agent Launch may text this number with operational SA360 delivery notifications\. Message frequency varies\. Message and data rates may apply\. Reply STOP to opt out\. Reply HELP for help\. Privacy Policy: (https:\/\/\S+) Terms: (https:\/\/\S+)$/;

const GHL_TEXT =
  /^Life Agent Launch may text this number when a lead is received in your GoHighLevel account\. Message frequency varies\. Message and data rates may apply\. Reply STOP to opt out\. Reply HELP for help\. Privacy Policy: (https:\/\/\S+) Terms: (https:\/\/\S+)$/;

/** True only for a stored external-webhook-sms-v2 sentence. */
export function smsDisclosureTextIsComplete(text: string): boolean {
  return disclosureTextMatches(text, V2_TEXT, composeSmsConsentText);
}

/** True only for the current GoHighLevel lead-received sentence. */
export function ghlLeadSmsDisclosureTextIsComplete(text: string): boolean {
  return disclosureTextMatches(text, GHL_TEXT, composeGhlLeadSmsConsentText);
}

function disclosureTextMatches(
  text: string,
  pattern: RegExp,
  compose: (urls: SmsLegalUrls) => string
): boolean {
  const match = pattern.exec(text);
  if (!match) return false;
  if (text.length < 160 || text.length > 500) return false;
  if (text.includes("@") || /\+\d{8,}/.test(text)) return false;
  const privacyPolicyUrl = publicLegalUrl(match[1]);
  const termsUrl = publicLegalUrl(match[2]);
  if (!privacyPolicyUrl || !termsUrl || privacyPolicyUrl !== match[1] || termsUrl !== match[2]) return false;
  if (privacyPolicyUrl === termsUrl) return false;
  return text === compose({ privacyPolicyUrl, termsUrl });
}

export function readSmsDisclosure(env: NodeJS.ProcessEnv = process.env): SmsDisclosureView {
  const urls = readSmsLegalUrls(env);
  const text = urls ? composeGhlLeadSmsConsentText(urls) : null;
  return {
    version: SMS_CONSENT_VERSION_GHL,
    businessName: SMS_DISCLOSURE.businessName,
    program: SMS_DISCLOSURE.program,
    purpose: SMS_DISCLOSURE.purpose,
    frequency: SMS_DISCLOSURE.frequency,
    rates: SMS_DISCLOSURE.rates,
    stop: SMS_DISCLOSURE.stop,
    help: SMS_DISCLOSURE.help,
    privacyPolicyUrl: urls?.privacyPolicyUrl ?? null,
    termsUrl: urls?.termsUrl ?? null,
    recordable: text != null && ghlLeadSmsDisclosureTextIsComplete(text),
    text,
  };
}

export function smsOptInPublicOrigin(env: NodeJS.ProcessEnv = process.env): string | null {
  const origin = publicLegalUrl(env[SMS_OPT_IN_PUBLIC_ORIGIN_ENV]);
  if (!origin) return null;
  try {
    const url = new URL(origin);
    if (url.pathname !== "/" && url.pathname !== "") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function smsVerbalOperatorAllowed(email: string): boolean {
  return (SMS_VERBAL_OPERATOR_EMAILS as readonly string[]).includes(email.trim().toLowerCase());
}

export function smsOptInClientAccountId(env: NodeJS.ProcessEnv = process.env): string | null {
  const id = env[SMS_OPT_IN_CLIENT_ENV]?.trim() ?? "";
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) return null;
  return id;
}

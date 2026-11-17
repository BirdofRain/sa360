/**
 * Process gate for one internal SMS canary.
 * Any canary variable, even an incomplete one, is enough to stop global
 * notice discovery and worker drains. Production leaves every variable unset.
 */

export const SMS_CANARY_ENABLED_ENV = "SA360_SMS_CANARY_ENABLED";
export const SMS_CANARY_CLIENT_ENV = "SA360_SMS_CANARY_CLIENT_ACCOUNT_ID";
export const SMS_CANARY_ATTEMPT_ENV = "SA360_SMS_CANARY_ATTEMPT_ID";
export const SMS_CANARY_RECIPIENT_ENV = "SA360_SMS_CANARY_RECIPIENT_E164";

const CLIENT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const ATTEMPT_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,80}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export type SmsCanaryIsolation =
  | { mode: "off" }
  | { mode: "holding" }
  | {
      mode: "ready";
      clientAccountId: string;
      attemptId: string;
      recipientE164: string;
    };

export function readSmsCanaryIsolation(env: NodeJS.ProcessEnv = process.env): SmsCanaryIsolation {
  const enabled = env[SMS_CANARY_ENABLED_ENV];
  const clientAccountId = env[SMS_CANARY_CLIENT_ENV]?.trim() ?? "";
  const attemptId = env[SMS_CANARY_ATTEMPT_ENV]?.trim() ?? "";
  const recipientE164 = env[SMS_CANARY_RECIPIENT_ENV]?.trim() ?? "";
  const anySet = Boolean(enabled?.trim() || clientAccountId || attemptId || recipientE164);
  if (!anySet) return { mode: "off" };
  if (enabled?.trim() !== "true") return { mode: "holding" };
  if (!CLIENT_ID.test(clientAccountId) || !ATTEMPT_ID.test(attemptId) || !E164.test(recipientE164)) {
    return { mode: "holding" };
  }
  return { mode: "ready", clientAccountId, attemptId, recipientE164 };
}

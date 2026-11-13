/**
 * Canonical staff sign-in URL. No Node crypto, so client code can import it.
 * Invitation links and the login button cannot use any other public host.
 */
export const STAFF_SIGN_IN_ORIGIN = "https://portal.lifeagentlaunch.com";
export const STAFF_SIGN_IN_PATH = "/staff/google/start";
export const STAFF_SIGN_IN_URL = `${STAFF_SIGN_IN_ORIGIN}${STAFF_SIGN_IN_PATH}`;

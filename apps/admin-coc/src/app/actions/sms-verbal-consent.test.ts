import assert from "node:assert/strict";
import module from "node:module";
import test from "node:test";

const moduleLoader = module as unknown as {
  _load: (request: string, parent: NodeModule, isMain: boolean) => unknown;
};
const originalLoad = moduleLoader._load;
moduleLoader._load = function (request: string, parent: NodeModule, isMain: boolean) {
  if (request === "server-only") return {};
  return originalLoad.call(this, request, parent, isMain);
};

const SECRET = "admin-coc-session-secret-32b";
const ADMIN_KEY = "server-admin-key-not-for-browser";
const CLIENT = "sms_phone_format";
const CANONICAL = "+19193096948";

type Call = { method: string; url: string; body: string | null };

test("both SMS actions send one canonical number and leave a STOP refusal unchanged", async () => {
  const previous = snapshotEnv();
  process.env.ADMIN_COC_PASSWORD = "operator-password";
  process.env.ADMIN_COC_SESSION_SECRET = SECRET;
  process.env.NEXT_PUBLIC_SA360_API_BASE_URL = "https://api.example.test";
  process.env.SA360_ADMIN_API_KEY = ADMIN_KEY;
  const calls: Call[] = [];
  const original = globalThis.fetch;
  let stopped = false;
  globalThis.fetch = (async (_input: RequestInfo | URL, init?: RequestInit) => {
    const body = typeof init?.body === "string" ? init.body : null;
    calls.push({ method: init?.method ?? "GET", url: String(_input), body });
    if (stopped) {
      return json({ ok: false, error: "stop_suppressed" }, 409);
    }
    const verbal = String(_input).includes("/sms-verbal-consent");
    return json({
      ok: true,
      status: verbal ? "pending_confirmation" : undefined,
      smsEnabled: false,
      consentRecorded: false,
      email: "sent",
    });
  }) as typeof fetch;

  try {
    const session = await import("../../lib/admin-coc-session.ts");
    const guard = await import("../../lib/admin-coc-session-guard.ts");
    guard.useAdminCocTestSessionCookie(session.createAdminCocSessionToken(undefined, SECRET, "ADMIN") ?? undefined);
    const actions = await import("./sms-verbal-consent.ts");

    const rejected = await actions.recordVerbalSmsConsentAction(verbal("(919) 309-6948 ext 4"));
    assert.equal(rejected.ok, false);
    const rejectedLink = await actions.issueSmsOptInLinkAction(link("447911123456"));
    assert.equal(rejectedLink.ok, false);
    assert.equal(calls.length, 0);

    for (const raw of ["9193096948", "(919) 309-6948", "1-919-309-6948", "+19193096948"]) {
      const saved = await actions.recordVerbalSmsConsentAction(verbal(raw));
      assert.equal(saved.ok, true);
      if (saved.ok) {
        assert.equal(saved.smsEnabled, false);
        assert.equal(saved.consentRecorded, false);
        assert.equal(saved.status, "pending_confirmation");
      }
      const issued = await actions.issueSmsOptInLinkAction(link(raw));
      assert.equal(issued.ok, true);
      if (issued.ok) {
        assert.equal(issued.smsEnabled, false);
        assert.equal(issued.consentRecorded, false);
      }
    }

    const international = await actions.issueSmsOptInLinkAction(link("+44 7911 123456"));
    assert.equal(international.ok, true);

    const phones = calls.map((call) => JSON.parse(call.body ?? "{}") as { phoneE164?: string; smsEnabled?: boolean });
    assert.deepEqual(
      phones.map((body) => body.phoneE164),
      [CANONICAL, CANONICAL, CANONICAL, CANONICAL, CANONICAL, CANONICAL, CANONICAL, CANONICAL, "+447911123456"]
    );
    assert.equal(phones.every((body) => body.smsEnabled === undefined), true);
    assert.equal(new Set(calls.filter((call) => call.url.includes("/sms-verbal-consent")).map((call) => call.body)).size, 1);
    assert.equal(new Set(calls.filter((call) => call.url.includes("/sms-opt-in-link") && call.body?.includes(CANONICAL)).map((call) => call.body)).size, 1);

    stopped = true;
    const beforeStop = calls.length;
    const verbalStop = await actions.recordVerbalSmsConsentAction(verbal("(919) 309-6948"));
    const linkStop = await actions.issueSmsOptInLinkAction(link("919-309-6948"));
    assert.equal(verbalStop.ok, false);
    assert.equal(linkStop.ok, false);
    if (!verbalStop.ok) assert.match(verbalStop.error, /Texts stay off/);
    if (!linkStop.ok) assert.match(linkStop.error, /Texts stay off/);
    const stopBodies = calls.slice(beforeStop).map((call) => JSON.parse(call.body ?? "{}") as { phoneE164?: string });
    assert.deepEqual(stopBodies.map((body) => body.phoneE164), [CANONICAL, CANONICAL]);
  } finally {
    globalThis.fetch = original;
    const guard = await import("../../lib/admin-coc-session-guard.ts");
    guard.useAdminCocTestSessionCookie(undefined);
    restoreEnv(previous);
  }
});

function verbal(phoneE164: string) {
  return {
    clientAccountId: CLIENT,
    phoneE164,
    affirmativeResponse: "Yes, text me.",
    confirmationEmail: "person@lifeagentlaunch.invalid",
    evidence: "Call note",
  };
}

function link(phoneE164: string) {
  return {
    clientAccountId: CLIENT,
    phoneE164,
    confirmationEmail: "person@lifeagentlaunch.invalid",
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

function snapshotEnv() {
  return {
    ADMIN_COC_PASSWORD: process.env.ADMIN_COC_PASSWORD,
    ADMIN_COC_SESSION_SECRET: process.env.ADMIN_COC_SESSION_SECRET,
    NEXT_PUBLIC_SA360_API_BASE_URL: process.env.NEXT_PUBLIC_SA360_API_BASE_URL,
    SA360_ADMIN_API_KEY: process.env.SA360_ADMIN_API_KEY,
  };
}

function restoreEnv(previous: ReturnType<typeof snapshotEnv>) {
  for (const [key, value] of Object.entries(previous)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}

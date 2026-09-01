# Portal auth integrated regression (2026-09-01)

Validation-only proof that merged PRs **#109** (per-customer password + session
epoch), **#111** (one-time invite accept), and **#112** (C.O.C. invite controls)
work together on local `sa360_test`.

No product behavior was changed. No production deploy. No production writes.
No real email (Resend/SMTP unused; `RESEND_API_KEY` unset in the harness).
All Prisma work targeted local `127.0.0.1:5432/sa360_test`.
`SA360_TEST_DATABASE_URL` was validated by `assertSafeTestDatabaseUrl`
(localhost host, database name contains `test`).

## 1. Master SHA

`0cdc98eaf7f6dea9f5dcbad75fd477684e558272`

- `origin/master` at start: `0cdc98e feat(admin-coc): add customer portal invite controls (#112)`
- Branch: `validation/portal-auth-integrated-regression-2026-09-01`
- PR #112 title confirmed: "feat(admin-coc): add customer portal invite controls"

## 2. Fixture tenants

Two portal-enabled `ClientAccount` rows plus one minimal `LeadOrder` each.

| Tenant | `clientAccountId` | `portalLoginEmail` | Initial hash / epoch | Final hash / epoch |
| --- | --- | --- | --- | --- |
| A (converted) | `client_portal_authreg_a_20260901` | `tenant.a.authreg.20260901@example.test` | `portalPasswordHash` null, epoch **0** | `scrypt$…` set, epoch **2** |
| B (unconverted) | `client_portal_authreg_b_20260901` | `tenant.b.authreg.20260901@example.test` | hash null, epoch **0** | hash still null, epoch **0** |

Orders: `LO-AUTHREG-A-20260901` (A) and `LO-AUTHREG-B-20260901` (B).
Harness passwords (test-only, not production): shared env
`shared-env-regression-20260901`; A then `tenant-a-pw1-authreg-20260901` then
`tenant-a-pw2-authreg-20260901`. Fixtures deleted in `after()`.

## 3. Invite issuance proof

`POST /admin/v1/clients/:A/portal-invite` with `x-sa360-admin-key` (real
`issuePortalInvite()` via Fastify inject, `inviteDeps.db` = test Prisma):

- HTTP **200**, `inviteUrl` contains `/portal/invite/<rawToken>`
- Raw token matches `^[A-Za-z0-9_-]{32,64}$` / `isWellFormedPortalInviteToken`
- DB `portalInviteTokenHash` is 64 hex, equals `hashPortalInviteToken(raw)`,
  not equal to raw
- `expiresAt` and DB `portalInviteExpiresAt` within a few seconds of
  `now + PORTAL_INVITE_TTL_MS` (48h)
- Issue JSON has no hashes; admin GET detail after issue:
  `hasOutstandingPortalInvite` true, `hasPortalPassword` false, no plaintext
  token / `portalPasswordHash` / `portalInviteTokenHash`

## 4. Conversion proof

Optional `POST /client/v1/portal-invite/inspect` → `{ ok: true }`.
`POST /client/v1/portal-invite/accept` `{ token, password: PW1 }`:

- HTTP **200** `{ ok: true }` only
- DB: `portalPasswordHash` starts with `scrypt$` and ≠ plaintext
- `portalPasswordSetAt` set
- invite hash + expiry cleared
- `portalSessionEpoch` **0 → 1**
- Replay accept → **400** `INVITE_INVALID` / `PORTAL_INVITE_INVALID`, no
  account id or email leak

## 5. Session revocation proof

Pre-conversion session represented as
`{ clientAccountId: A, portalSessionEpoch: 0 }`.

- `GET /client/v1/portal-session-state?clientAccountId=A` before accept: epoch **0**,
  `portalEnabled` true
- `isPortalSessionEpochCurrent(0, 0) === true` (same contract
  `readTrustedPortalSession` uses)
- After accept: session-state epoch **1**
- `isPortalSessionEpochCurrent(0, 1) === false` — old epoch-0 session is not
  trusted. Edge middleware remains HMAC-only and is not this check.

## 6. Shared-password isolation proof

| Login | Result |
| --- | --- |
| A + shared env (before convert) | **200** `passwordCheck=env_fallback`, epoch 0 |
| A + PW1 (after convert) | **200** `passwordCheck=customer`, epoch 1 |
| A + shared env (after convert) | **401** `INVALID` |
| B + shared env (A converted) | **200** `env_fallback`, B epoch stays 0, hash still null |

Converted tenants cannot use `CLIENT_PORTAL_LOGIN_PASSWORD`. Unconverted
tenants keep the migration fallback.

## 7. Reset proof

Second admin invite for A, accept with PW2:

- epoch **1 → 2**
- `isPortalSessionEpochCurrent(1, 2) === false`
- A + PW1 → **401**
- A + PW2 → **200** `customer`, epoch 2
- A + env password still **401**
- B still `env_fallback`

## 8. Tenant isolation proof

- B email + A PW1 → **401** `INVALID`
- `GET /client/v1/lead-orders?clientAccountId=A` → A's order present, B's absent
- `GET /client/v1/lead-orders/:B_ORDER_ID?clientAccountId=A` → **404**
- `GET …/:B_ORDER_ID/leads?clientAccountId=A` → **404**
- `GET …/:B_ORDER_ID/exports?clientAccountId=A` → **404**
- `portalBffHasBrowserTenantOverride(URLSearchParams with clientAccountId)` is
  **true** (BFF must reject browser tenant override). Same helper as
  `apps/admin-coc/src/lib/client-portal/portal-bff-auth.ts`.

API `resolveClientPortalTenant` still accepts query `clientAccountId` when the
server-side portal API key is present (server-to-server). That is not the
browser BFF path.

## 9. Remaining legacy auth risks (not changed)

Recorded from current `master` sources. **No product patch.**

1. **`?access=` grant.** `apps/admin-coc/src/app/portal/page.tsx` still treats a
   matching `CLIENT_PORTAL_ACCESS_CODE` as a session grant:
   `portalSignedSessionCookieOptions()` with **no session input** →
   `createLegacyPortalSessionToken()` in `access-gate.ts`, bound to
   `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` at epoch **0**. A valid access code can
   still mint a signed legacy/env-tenant session.
2. **Middleware bypass.** `apps/admin-coc/src/middleware.ts` lets
   `/portal?access=` through without a prior session (HMAC check skipped for
   that query).
3. **API query `clientAccountId`.** With `x-sa360-client-portal-key`,
   `resolveClientPortalTenant` honors the query param. Safe only if the key
   never reaches the browser (BFF rejects override; raw API does not).
4. **Edge HMAC-only.** `portal-session-edge.ts` / middleware verify signature
   and expiry only. Epoch revocation is Node (`readTrustedPortalSession` +
   `GET /client/v1/portal-session-state`). A stale-epoch cookie can pass Edge
   until a Node loader/BFF check.

These remain hardening work. This regression did not change them.

## 10. Tests / counts

**120 passed / 0 failed** across the targeted files.

### Connected integration

| File | Result |
| --- | --- |
| `apps/api/src/services/portal-auth/portal-auth-integrated-regression.integration.test.ts` | **1 passed / 0 failed** |

### #109 foundation

| File | Result |
| --- | --- |
| `apps/api/src/lib/portal-password.test.ts` | **5 / 0** |
| `apps/api/src/lib/portal-password-policy.test.ts` | **1 / 0** |
| `apps/api/src/services/portal-login.service.test.ts` | **9 / 0** |
| `apps/api/src/routes/client-portal.routes.test.ts` | **8 / 0** |
| `apps/api/src/services/client-account-profile.present.test.ts` | **3 / 0** |
| `apps/admin-coc/src/lib/client-portal/portal-auth.test.ts` | **9 / 0** |
| `apps/admin-coc/src/lib/client-portal/portal-auth-flow.test.ts` | **12 / 0** |
| `apps/admin-coc/src/lib/client-portal/portal-session.test.ts` | **6 / 0** |
| `apps/admin-coc/src/lib/client-portal/account-profile.test.ts` | **5 / 0** |
| `apps/admin-coc/src/lib/client-portal/access-gate.test.ts` | **7 / 0** |

### #111 invite

| File | Result |
| --- | --- |
| `apps/api/src/lib/portal-invite-token.test.ts` | **4 / 0** |
| `apps/api/src/services/portal-invite.service.test.ts` | **16 / 0** |
| `apps/api/src/routes/portal-invite.routes.test.ts` | **6 / 0** |
| `apps/admin-coc/src/lib/client-portal/portal-invite-flow.test.ts` | **3 / 0** |
| `apps/admin-coc/src/lib/client-portal-api/portal-invite.test.ts` | **2 / 0** |
| `apps/admin-coc/src/components/client-portal/portal-invite-form.test.tsx` | **1 / 0** |

### #112 operator

| File | Result |
| --- | --- |
| `apps/admin-coc/src/lib/clients/portal-invite-operator.test.ts` | **8 / 0** |
| `apps/admin-coc/src/components/clients/client-portal-access-section.test.tsx` | **12 / 0** |
| `apps/api/src/services/client-onboarding.present.test.ts` | **2 / 0** |

Commands (local `sa360_test` only):

```
SA360_TEST_DATABASE_URL=postgresql://sa360:***@127.0.0.1:5432/sa360_test

# API targeted files (unit + connected)
pnpm --filter @sa360/api exec node --import tsx/esm --import ./src/test/set-test-env.ts \
  --import ./src/test/prisma-test-teardown.ts --test --test-concurrency=1 \
  src/lib/portal-password.test.ts \
  src/lib/portal-password-policy.test.ts \
  src/services/portal-login.service.test.ts \
  src/routes/client-portal.routes.test.ts \
  src/services/client-account-profile.present.test.ts \
  src/lib/portal-invite-token.test.ts \
  src/services/portal-invite.service.test.ts \
  src/routes/portal-invite.routes.test.ts \
  src/services/client-onboarding.present.test.ts \
  src/services/portal-auth/portal-auth-integrated-regression.integration.test.ts

# admin-coc targeted files
pnpm --filter @sa360/admin-coc exec tsx --import ./src/test/happy-dom-register.ts --test \
  src/lib/client-portal/portal-auth.test.ts \
  src/lib/client-portal/portal-auth-flow.test.ts \
  src/lib/client-portal/portal-session.test.ts \
  src/lib/client-portal/account-profile.test.ts \
  src/lib/client-portal/access-gate.test.ts \
  src/lib/client-portal/portal-invite-flow.test.ts \
  src/lib/client-portal-api/portal-invite.test.ts \
  src/components/client-portal/portal-invite-form.test.tsx \
  src/lib/clients/portal-invite-operator.test.ts \
  src/components/clients/client-portal-access-section.test.tsx
```

Combined API unit batch: **54 passed / 0 failed**.
Combined admin-coc batch: **65 passed / 0 failed**.
Connected integration: **1 passed / 0 failed**.

## 11. Files changed (test/docs only)

- `apps/api/src/services/portal-auth/portal-auth-integrated-regression.fixtures.ts`
- `apps/api/src/services/portal-auth/portal-auth-integrated-regression.integration.test.ts`
- `docs/validation/portal-auth-integrated-regression-2026-09-01.md` (this report)

No product, schema, route, or migration changes.

## 12. Operator UI after conversion

Admin GET `/admin/v1/clients/:A` after accept: `hasPortalPassword` true,
`hasOutstandingPortalInvite` false. `portalPasswordStatusLabel(true) === "Set"`.
Existing `client-portal-access-section.test.tsx` covers button
**Generate password reset invite**, no **Show Password**, no
`CLIENT_PORTAL_LOGIN_PASSWORD` instruction.

## 13. Risks / follow-ups

- Legacy `?access=` and Edge HMAC-only checks remain (section 9).
- Server-side portal API key + query `clientAccountId` can still select a
  tenant; keep the key off the browser.
- Direct import of admin-coc session modules from the API test runner hits an
  ESM cycle; the connected test inlines the same
  `isPortalSessionEpochCurrent` / `portalBffHasBrowserTenantOverride` /
  `portalPasswordStatusLabel` contracts and cites the product files.
- This does not activate production portal flags or send invite email.

## 14. Verdict

**PASS — PORTAL AUTH CONVERSION CONTRACT PROVEN**

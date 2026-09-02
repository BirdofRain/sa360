# SA360 legacy portal access-code cutover — 2026-09-01

Read-only production verification after the operator manually removed
`CLIENT_PORTAL_ACCESS_CODE` from Admin C.O.C. on DigitalOcean App Platform.

Started from current `origin/master`. No environment variable was changed by
this audit. No deploy was triggered. No portal invite was issued. No customer
password was set. No customer was converted. No migration was run. No email
was sent. No PPL / LF2 / NextGen / GHL flag was changed. No production row
was written. Secret values are never printed in this file. The former
production access-code value was not retrieved or reused.

**Audit window:** 2026-09-01T21:06Z–21:12Z (UTC)  
**Git baseline:** `origin/master` = `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`  
**Method:** DigitalOcean App Platform metadata (`doctl` read only), public and
authorized HTTP reads, Prisma `SELECT` / `COUNT` with
`default_transaction_read_only = on`, live C.O.C. browser login then sign-out.

An earlier authorized write attempt the same day (18:34Z–18:42Z) failed with
`doctl apps update` **403** and left the key **SET**. That attempt created no
deployment and changed no customer row. This run only verifies the later
operator removal.

---

## FINAL VERDICT

**GREEN — LEGACY ACCESS BYPASS REMOVED, READY FOR DEMO ACCOUNT CONVERSION**

Production Admin C.O.C. no longer has `CLIENT_PORTAL_ACCESS_CODE` on the
desired spec or the running deploy spec (47 app-level keys; was 48). Required
login configuration remains SET. `/portal?access=<any-value>` cannot mint a
legacy session: the live process has no expected code, current master treats
a missing/blank env as invalid, and a synthetic probe redirects to
`/portal/login` with no portal session cookie. Ordinary shared-password
login still works for Smart Agent 360 Demo (unconverted, epoch 0). Customer
counts remain 3 / 0 / 0. Migrations remain 73/73. Delivery remains simulate.

Convert paying tenants one at a time after this. Do not re-set
`CLIENT_PORTAL_ACCESS_CODE`.

---

## Return card

| Item | Result |
| --- | --- |
| Legacy access code | **UNSET** |
| Normal portal login | **PASS** |
| Portal-enabled tenants | **3** |
| Converted tenants | **0** |
| Outstanding invites | **0** |
| API health | **200** (`/health`, `/health/db`, `/health/queue`) |
| Admin health | **200** (authorized `/admin/v1/health`) |
| Migration state | **73/73** applied, **0** failed |

---

## 1. Master / production SHA

`origin/master` = `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`  
`fix(build): type API test fixtures for production tsc (#114)`

Local `master` is two documentation commits ahead of `origin/master` (this
file and the post-#114 verification). Production code SHA is still the
`origin/master` tip.

| Component | App | Active deploy | Cause | Source SHA | vs origin/master |
| --- | --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` `2c381355-37a1-415f-bf06-ad477add164e` | `97744d5e` **ACTIVE** | commit `5c92ece` | `5c92ece` | **MATCH** |
| Worker (`sa360-worker`) | same | same | same | `5c92ece` | **MATCH** |
| migrate (`sa360-migrate`) | same | same | same | `5c92ece` | **MATCH** |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` | `de741efc` **ACTIVE** | **app spec updated** | `5c92ece` | **MATCH** |

Admin C.O.C. previous live deploy was `19600345` (post-#114, same SHA). The
new deploy `de741efc` was created **2026-09-01T20:51:25Z**, **ACTIVE**
**20:56:34Z**. That is the spec-update restart after the operator removed
the access-code key. API/worker were not redeployed.

No in-progress deployment. No `ERROR`.

Live `GET /health` and authorized `GET /admin/v1/health` both report
`commitSha=5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`,
`buildSource=SA360_BUILD_COMMIT_SHA`.

**Fleet status: ONE SHA.**

---

## 2. Health

API origin: `https://sa360-sw6oq.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitShort=5c92ece` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |

---

## 3. Env presence (values never printed)

Checked on the current desired spec **and** the running Admin C.O.C. deploy
spec (`de741efc`). Presence only.

| Variable | sa360 (API/worker) | admin-coc desired | admin-coc running deploy |
| --- | --- | --- | --- |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** | **UNSET** | **UNSET** |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | UNSET | **SET** | **SET** |
| `CLIENT_PORTAL_SESSION_SECRET` | UNSET | **SET** | **SET** |
| `CLIENT_PORTAL_API_KEY` | **SET** | **SET** | **SET** |
| `CLIENT_PORTAL_LOGIN_EMAIL` | UNSET | SET_EMAIL_SHAPED | SET_EMAIL_SHAPED |

Admin C.O.C. app-level env key count: **47** (was **48** when the key was
SET). No other required auth key was cleared.

`CLIENT_PORTAL_CLIENT_ACCOUNT_ID` remains SET on the API app and UNSET on
C.O.C. Unchanged mismatch; not used by the Demo-tenant login path that
bound from `portalLoginEmail`.

---

## 4. Legacy `?access=` path is dead

### Live configuration

The running Admin C.O.C. process (`de741efc`, spec-updated, SHA `5c92ece`)
does not have `CLIENT_PORTAL_ACCESS_CODE`.

### Current code on that SHA

`getClientPortalAccessCode()` returns `undefined` when the env var is
missing or blank. `isValidPortalAccessCode()` then returns `false` for any
provided string (`apps/admin-coc/src/lib/client-portal/access-gate.ts`).
`/portal?access=` only mints a signed session when
`isValidPortalAccessCode(accessParam)` is true
(`apps/admin-coc/src/app/portal/page.tsx`). Middleware still lets
`/portal?access=` through the Edge gate
(`apps/admin-coc/src/middleware.ts`); the page then refuses the grant and
resolves `login_required`.

### Live HTTP / browser (synthetic value only)

Former production code was **not** retrieved or used.
Probe: `__sa360_invalid_access_probe__`

| Probe | Result |
| --- | --- |
| `GET /portal` (no query) | **307** `Location: /portal/login?next=%2Fportal` — no portal session cookie |
| `GET /portal?access=__sa360_invalid_access_probe__` | RSC document **200** with `NEXT_REDIRECT;replace;/portal/login;307` — **no** `sa360_client_portal_session` / `sa360_client_portal_access` cookie |
| Browser open of the same `?access=` URL | Lands on **`/portal/login`** “Sign in to your dashboard” — not the dashboard, not the access-gate form |

Because the expected env code is absent, every provided string — including
the former production value — fails `isValidPortalAccessCode`.

---

## 5. Ordinary portal login (shared-password fallback)

Tenant used: **Smart Agent 360 Demo** (portal-enabled, `portalPasswordHash`
null, `portalSessionEpoch` 0, no invite). Login email withheld.

| Check | Result |
| --- | --- |
| `GET /portal/login` | **200**, sign-in form present |
| API `POST /client/v1/portal-login` (authorized) | **200** `passwordCheck=env_fallback`, `portalEnabled=true`, `hasPortalPassword=false`, epoch **0** |
| C.O.C. browser login with shared-env password | **PASS** — redirected to `/portal`, header **Smart Agent 360 Demo**, Sign out, live orders (LO-1049 ready) |
| Sign-out | Returned to `/portal/login` |
| Customer row after login + sign-out | hash still null, epoch still 0, invite still null |

API `CLIENT_PORTAL_LOGIN_PASSWORD` is UNSET by design (#109 BFF-verify). The
shared-password check runs on Admin C.O.C. The successful C.O.C. login is
the operational proof. No credential values are recorded here.

No account was converted.

---

## 6. Customer state

Read-only. `default_transaction_read_only = on`. Host (masked):
`sa360-postgres-do-user-1494645-0.k.db.ondigitalocean.com:25060` database
`defaultdb`.

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted passwords | **0** |
| Outstanding invites | **0** |

| Safe display name | portalEnabled | login email? | hasPortalPassword | portalSessionEpoch | outstanding invite | status |
| --- | --- | --- | --- | --- | --- | --- |
| Breanna Kimberling | true | yes | false | 0 | no | onboarding |
| Smart Agent 360 Demo | true | yes | false | 0 | no | active |
| Vet Life — James Torrey | true | yes | false | 0 | no | active |

Eleven `ClientAccount` rows total. Unchanged from the post-#114 verification
and from the earlier failed write attempt.

---

## 7. Migrations

Repository migration directories: **73**.

Production `_prisma_migrations` (SELECT only):

| Metric | Count |
| --- | --- |
| Applied (`finished_at` set, not rolled back) | **73** |
| Pending vs repository | **0** |
| Failed / unfinished | **0** |

Latest two (unchanged since post-#114 PRE_DEPLOY):

- `20260831190000_client_account_portal_password_foundation` — applied
  `2026-09-01T18:10:36.634Z`
- `20260831210000_client_account_portal_invite` — applied
  `2026-09-01T18:10:36.653Z`

`prisma migrate deploy` was **not** run from this workstation.

---

## 8. Delivery safety

Unchanged. Nothing was written.

| Control | Production |
| --- | --- |
| NextGen | **capture_only** (`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` SET to that value on `sa360-api`) |
| LF2 execution | **off** (`SA360_LF2_EXECUTION_ENABLED` absent; safety `lf2ExecutionEnabled: false`) |
| LF2 GHL canary | **off** (`lf2GhlCanaryEnabled: false`, allowlists unset) |
| Delivery runtime | **simulate** (`GET /admin/v1/delivery-runtime-mode` → `effectiveMode=simulate`, `canRunLiveCanary=false`) |
| Effective GHL | **simulate** (runtime). Env `GHL_DELIVERY_ADAPTER_MODE` remains `live_canary`; the runtime row keeps live canary closed. |
| Safety | `GET /admin/v1/fulfillment-ops/safety` → **200**, `simulationOnly: true`, `liveDeliveryEnabled: false` |

---

## 9. Matrix

| Item | Result |
| --- | --- |
| Legacy access code before operator removal | **SET** (C.O.C. only) |
| Legacy access code now | **UNSET** (desired + running deploy) |
| Admin C.O.C. status | ACTIVE `de741efc` SHA `5c92ece` (spec update) |
| API / worker status | ACTIVE `97744d5e` SHA `5c92ece` |
| Portal normal login | **PASS** (Demo, shared-password fallback) |
| Portal-enabled tenants | 3 |
| Converted tenants | 0 |
| Outstanding invites | 0 |
| Migrations | 73/73 |
| NextGen / LF2 / GHL | capture_only / off / simulate |

**A. Was `CLIENT_PORTAL_ACCESS_CODE` removed?**  
**YES.** Absent from the live Admin C.O.C. spec and the running deploy spec.

**B. Can `/portal?access=` still create a legacy authenticated session?**  
**NO.**

**C. Is it safe to convert the first portal account (Demo)?**  
**YES**, one-at-a-time, without re-enabling the access code.

---

## What this task did not do

- No DigitalOcean spec write, env edit, deploy, rollback, or retry
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance
- No password set or customer conversion
- No use of the former production access code
- No email, flag, NextGen, LF2, or GHL change
- No product PR

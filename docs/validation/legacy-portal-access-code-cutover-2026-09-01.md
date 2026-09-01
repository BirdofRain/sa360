# SA360 legacy portal access-code cutover — 2026-09-01

Authorized, narrow production config change: unset
`CLIENT_PORTAL_ACCESS_CODE` on Admin C.O.C. only.

No other environment variables were changed. No portal invite was issued. No
customer password was set. No customer record was written. No code deploy was
triggered. No migration was run. No PPL / LF2 / NextGen / GHL configuration
was changed. No email was sent. The former access-code value is never printed
in this file.

**Audit window:** 2026-09-01T18:34Z–18:42Z (UTC)  
**Git baseline:** `origin/master` = `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`  
**Method:** DigitalOcean App Platform metadata (`doctl` read + attempted
`doctl apps update`), public and authorized HTTP reads, Prisma `SELECT` /
`COUNT` with `default_transaction_read_only = on`.

---

## FINAL VERDICT

**RED — STOP BEFORE CUSTOMER CONVERSION**

Exact failure: the authorized unset was **not applied**. Production
`CLIENT_PORTAL_ACCESS_CODE` is still **SET** on Admin C.O.C.

Pre-write state matched the post-#114 GREEN baseline (one SHA `5c92ece`,
migrations 73/73, health 200, three unconverted portal tenants, zero
invites). The spec edit was prepared as a single-key removal (48 → 47 env
keys; login password / session secret / portal API key left SET). Applying
it via the supported mechanism failed:

1. `doctl apps update` with the full live spec minus only
   `CLIENT_PORTAL_ACCESS_CODE` → **403**  
   `dbaas list request failed … missing the required per[mission]`
   (token cannot `database:read` while the spec still lists
   `databases: sa360-postgres`).
2. Same PUT with the `databases` block omitted (so DBaaS validation is not
   invoked) → **403 forbidden**. That variant was not retried as a
   workaround that might detach the database component.

Failed PUTs did **not** create a deployment. Active deploys remain the
post-#114 pair. No production env or customer row changed.

Do **not** convert a portal tenant until the access code is actually UNSET
and steps 4–8 below are re-run green.

---

## 1. Pre-write check

All expected. Cutover was allowed to proceed to the write attempt.

| Check | Result |
| --- | --- |
| Admin C.O.C. SHA | `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4` ACTIVE `19600345` |
| API SHA | `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4` ACTIVE `97744d5e` |
| Worker SHA | `5c92ece` (same `sa360` deploy) |
| `GET /health` | **200** `commitShort=5c92ece` |
| `GET /health/db` | **200** |
| `GET /health/queue` | **200** |
| `GET /admin/v1/health` | **200** `env=production` same SHA |
| `CLIENT_PORTAL_ACCESS_CODE` | **SET** on `sa360-admin-coc` app-level `RUN_AND_BUILD_TIME` (value withheld; length 12; not encrypted-shape) |
| Portal-enabled tenants | **3** |
| Converted passwords | **0** |
| Outstanding invites | **0** |
| `_prisma_migrations` | **73** applied, **0** failed |

Portal-enabled rows (unchanged): Breanna Kimberling (onboarding), Smart Agent
360 Demo (active), Vet Life — James Torrey (active). All
`portalPasswordHash` null, `portalSessionEpoch` 0, no invite hash.

No pre-write drift. The STOP-on-drift rule did not fire.

---

## 2. Config change

Intended change (only):

- App: `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7`
- Location: app-level `envs`
- Action: **remove** the `CLIENT_PORTAL_ACCESS_CODE` entry (canonical unset,
  not empty string)

Dry-run of the spec edit (values never printed):

| Metric | Before | After (prepared, not applied) |
| --- | --- | --- |
| Env keys | 48 | 47 |
| `CLIENT_PORTAL_ACCESS_CODE` | present | absent |
| Extra keys removed/added | — | **none** |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | SET | SET |
| `CLIENT_PORTAL_SESSION_SECRET` | SET | SET |
| `CLIENT_PORTAL_API_KEY` | SET | SET |
| `CLIENT_PORTAL_LOGIN_EMAIL` | SET | SET |
| `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` | UNSET | UNSET |

Apply command: `doctl apps update <admin-coc-id> --spec <patched.yaml>`
(`--update-sources` not used; no extra deploy requested).

**Result: not applied.** Current doctl context `sa360-prod-2026-08-24` can
read App Platform (list/get/spec/logs) and the account
(`sam@lifeagentlaunch.com` / team Smart Agent 360) but cannot complete an
app spec PUT. Control-panel edit was not available (unauthenticated browser
session).

Required scopes for a retry (from prior SA360 deploy runbooks):

- `app:read`
- `app:update` (or `app:write`)
- `database:read` (so the existing `databases: sa360-postgres` name can be
  sent back without a DBaaS 403)

Do **not** omit `databases` on a successful retry unless a follow-up `spec
get` immediately proves the attachment is still present.

---

## 3. Deploy / restart observation

No DigitalOcean deployment or restart was created.

| App | Active deploy | In progress |
| --- | --- | --- |
| `sa360-admin-coc` | `19600345` (`5c92ece`) | none |
| `sa360` | `97744d5e` (`5c92ece`) | none |

API `/health` remained **200** on `5c92ece` after the failed PUTs.

---

## 4. Verify env cutover

**Did not pass.** Live spec after the failed write:

| Variable | sa360 (API/worker) | admin-coc |
| --- | --- | --- |
| `CLIENT_PORTAL_ACCESS_CODE` | UNSET | **SET** (unchanged) |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | UNSET | **SET** |
| `CLIENT_PORTAL_SESSION_SECRET` | UNSET | **SET** |
| `CLIENT_PORTAL_API_KEY` | SET | **SET** |

No secret values.

---

## 5. Legacy path

Code-safe evidence (current master, same SHA as production C.O.C.):

`getClientPortalAccessCode()` returns `undefined` when the env var is missing
or blank. `isValidPortalAccessCode()` then returns `false` for any provided
string (`apps/admin-coc/src/lib/client-portal/access-gate.ts`).
`/portal?access=` only mints a signed session when
`isValidPortalAccessCode(accessParam)` is true
(`apps/admin-coc/src/app/portal/page.tsx`).

That is the behavior **after** a successful unset. It is **not** live yet
because the env var is still SET.

Harmless synthetic probe only (not the former production value):

`GET /portal?access=__sa360_invalid_access_probe__` → **200**, no
`sa360_client_portal_session` / `sa360_client_portal_access` cookie. Not
proof the real code is dead.

The former production code was **not** retrieved or reused.

---

## 6. Normal login

Not re-validated end-to-end against the shared-password fallback after a
cutover, because the cutover did not land.

Still true on the unchanged production SHA:

- `GET /portal/login` → **200**
- API health **200** on `5c92ece`
- Three portal-enabled tenants remain `portalEnabled=true` with no customer
  hash (shared-env fallback still the only password path)
- Required C.O.C. login env (`CLIENT_PORTAL_LOGIN_PASSWORD`,
  `CLIENT_PORTAL_SESSION_SECRET`, `CLIENT_PORTAL_API_KEY`) still SET

No credentials were printed. No account was converted.

---

## 7. Customer state

Read-only, after the failed write. Unchanged from pre-write.

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted passwords | **0** |
| Outstanding invites | **0** |

---

## 8. Delivery safety

Not re-sampled after a config change (none occurred). Last post-#114
production sample on this SHA, still the live API process:

| Control | Production |
| --- | --- |
| NextGen | `capture_only` |
| LF2 execution / GHL canary | off |
| Effective GHL / runtime | simulate, `canRunLiveCanary=false` |

No flags were touched here.

---

## 9. Matrix

| Item | Result |
| --- | --- |
| Legacy access code before | **SET** |
| Legacy access code after | **SET** (write failed; unchanged) |
| Admin C.O.C. status | ACTIVE `19600345` SHA `5c92ece` |
| API health | **200** SHA `5c92ece` |
| Portal normal login | page loads; fallback path not recertified after an unset that did not happen |
| Portal-enabled tenants | 3 |
| Converted tenants | 0 |
| Outstanding invites | 0 |

**A. Was `CLIENT_PORTAL_ACCESS_CODE` removed?**  
**NO.**

**B. Is it safe to convert the first portal account?**  
**NO.** The legacy `?access=` bypass is still armed.

### Required remaining action

1. Apply the same single-key spec removal with a token that has
   `app:update` + `database:read` (or delete the App-level variable in the
   DigitalOcean control panel). Do not empty-string it. Do not change any
   other key.
2. Observe the Admin C.O.C. auto-deploy/restart to ACTIVE. Do not click an
   extra Redeploy.
3. Re-run sections 4–8 of this runbook. Required: access code UNSET;
   login password / session secret / portal API key still SET; synthetic
   `?access=` still mints no session; `/portal/login` + shared-password
   fallback still works; 3 / 0 / 0 customer counts unchanged; delivery
   still simulate.

Until step 3 is green, the verdict stays **RED**.

---

## What this task did not do

- No successful DigitalOcean spec write
- No extra deploy / rollback
- No `prisma migrate deploy`
- No portal invite, password set, or customer conversion
- No use of the former production access code
- No email, flag, NextGen, LF2, or GHL change
- No product PR

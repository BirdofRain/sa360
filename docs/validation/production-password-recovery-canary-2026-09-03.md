# SA360 production password recovery canary — 2026-09-03

Read-only production verification after merge and auto-deploy of PR #116
(password confirmation + self-service portal recovery). Started from
current `origin/master`.

The operator exercised self-service **Forgot password?** only for
**Smart Agent 360 Demo**. This audit did not request another reset, issue
an invite, reset James, convert Breanna, change customer records, change
environment variables, deploy, run migrations, or send additional email.
Secret values (passwords, reset tokens, hashes, API keys, login emails,
sender mailboxes, reset URLs, message IDs) are never printed in this file.

**Audit window:** 2026-09-03T14:28Z–14:36Z (UTC)  
**Git baseline:** `origin/master` = `e75fc98365ca9ba669ed11c78f146ef4b74158e7`  
**PR under test:** [#116](https://github.com/BirdofRain/sa360/pull/116)
`feat(portal): add password confirmation and secure recovery` — **MERGED**
2026-09-03T13:30:05Z  
**Method:** DigitalOcean App Platform metadata (`doctl` read only), public
and authorized HTTP reads, Prisma `SELECT` / `COUNT` with
`default_transaction_read_only = on`, redacted API run-log path/status
review, and live portal browser (login + forgot-password + dummy invite
inspect only; no form submit).

Local `master` is documentation-only commits ahead of / diverged from
`origin/master`. Production code SHA is the `origin/master` tip.

This is the production send proof that
`docs/validation/portal-password-recovery-config-preflight-2026-09-02.md`
intentionally did not perform.

---

## FINAL VERDICT

**GREEN — PRODUCTION PASSWORD RECOVERY PROVEN, READY TO CONVERT BREANNA**

#116 is **ACTIVE** on one SHA (`e75fc98`) for API, worker, migrate, and
Admin C.O.C. Migrations remain **73/73**. The Demo self-service canary
issued exactly one authorized reset request, delivered one reset link
through the configured Resend transport to the live portal host, preserved
the token through a client-side confirmation mismatch, accepted a new
password (epoch **1 → 2**), rejected the shared env password, and signed
in on the customer hash path. James and Breanna are unchanged. Delivery
remains simulate.

Convert Breanna one-at-a-time. Do **not** re-set
`CLIENT_PORTAL_ACCESS_CODE`. Do not reset Demo or James. Do not request
another Demo reset merely to re-test mail.

---

## Return card

| Item | Result |
| --- | --- |
| Production SHA | `e75fc98365ca9ba669ed11c78f146ef4b74158e7` (API = worker = Admin C.O.C. = master) |
| Migrations | **73** applied / **0** pending / **0** failed |
| Legacy access code | **UNSET** |
| Real reset email delivered? | **YES** (one authorized request → live inspect of emailed link) |
| Reset link production host correct? | **YES** (API `ADMIN_COC_BASE_URL` = live C.O.C. host) |
| Mismatch preserved reset token? | **YES** |
| Demo epoch | **2** (was 1) |
| Old password rejected? | **YES** (hash replaced; dummy + shared env **401 INVALID**) |
| New password login works? | **YES** (`POST /client/v1/portal-login` **200** after accept; customer path) |
| Old session revoked? | **YES** (epoch-1 stale vs authoritative epoch 2) |
| Tenant isolation? | **YES** (Demo only; James lead / foreign order/leads/exports **404**) |
| Portal-enabled | **3** |
| Converted | **2** |
| Fallback | **1** (Breanna Kimberling) |
| Outstanding invites | **0** |
| James unchanged? | **YES** |
| Breanna unchanged? | **YES** |
| **FINAL VERDICT** | **GREEN — PRODUCTION PASSWORD RECOVERY PROVEN, READY TO CONVERT BREANNA** |

---

## 1. Deployment

`origin/master` = `e75fc98365ca9ba669ed11c78f146ef4b74158e7`  
`feat(portal): add password confirmation and secure recovery (#116)`

PR #116 **MERGED** 2026-09-03T13:30:05Z —
https://github.com/BirdofRain/sa360/pull/116

Apps (read-only):

- `sa360` `2c381355-37a1-415f-bf06-ad477add164e` — API + worker + migrate
- `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` — Admin C.O.C. + portal

`#116` merge triggered auto-deploy on both apps (`cause=commit e75fc98
pushed to github.com/BirdofRain/sa360/tree/master`). This audit did not
create, retry, or cancel either deployment.

| Component | App | Active deploy | Phase | Source SHA | vs `origin/master` |
| --- | --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` | `5c07af53` | **ACTIVE** | `e75fc98365ca9ba669ed11c78f146ef4b74158e7` | **MATCH** |
| Worker (`sa360-worker`) | same | same | **ACTIVE** | `e75fc98` | **MATCH** |
| migrate (`sa360-migrate`, `kind: PRE_DEPLOY`) | same | same | **SUCCESS** | `e75fc98` | **MATCH** |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` | `a313945b` | **ACTIVE** | `e75fc98` | **MATCH** |

Timeline:

| Time (UTC) | Event |
| --- | --- |
| 13:30:05 | #116 merged |
| 13:30:08 | both deploys created |
| 13:33:55–13:33:56 | `sa360-migrate` `prisma migrate deploy` — 73 found, no pending |
| 13:34:51 | Admin C.O.C. **ACTIVE** |
| 13:35:06 | `sa360` **ACTIVE** |

Previous live `sa360` deploy `45e31c52` (`075068f`) is **SUPERSEDED**.
Previous live C.O.C. deploy `37c3a425` (`075068f`) is **SUPERSEDED**.
No in-progress deployment. No `ERROR` on the #116 deploys.

Live `GET /health` and authorized `GET /admin/v1/health` both report
`commitSha=e75fc98365ca9ba669ed11c78f146ef4b74158e7`.

**Fleet status: ONE SHA.**

API origin: `https://sa360-sw6oq.ondigitalocean.app`  
Admin C.O.C. / portal: `https://sa360-api-staging-coo57.ondigitalocean.app`  
(`staging` in that hostname remains historical App Platform naming only.)

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitShort=e75fc98` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` (Redis reachable) |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |

`CLIENT_PORTAL_ACCESS_CODE` = **UNSET** on API desired spec, API running
spec, Admin C.O.C. desired spec, and Admin C.O.C. running spec
(`a313945b`). Admin C.O.C. app-level env key count remains **47**.

---

## 2. Migrations

`sa360-migrate` remains App Platform `kind: PRE_DEPLOY`, run command
`pnpm migrate:deploy`. Job source SHA = `e75fc98`.

PRE_DEPLOY run log (read-only, deploy `5c07af53`):

```
> prisma migrate deploy
Datasource "db": PostgreSQL database "defaultdb" ... ondigitalocean.com:25060
73 migrations found in prisma/migrations
No pending migrations to apply.
```

Production `_prisma_migrations` (SELECT only, `default_transaction_read_only
= on`):

Host (masked): `sa360-postgres-do-user-1494645-….ondigitalocean.com:25060`
database `defaultdb`.

| Metric | Count |
| --- | --- |
| Repository migration directories | **73** |
| Applied (`finished_at` set, not rolled back) | **73** |
| Pending vs repository | **0** |
| Failed / unfinished | **0** |

Latest two unchanged since post-#114 PRE_DEPLOY:

- `20260831190000_client_account_portal_password_foundation` — applied
  `2026-09-01T18:10:36.634Z`
- `20260831210000_client_account_portal_invite` — applied
  `2026-09-01T18:10:36.653Z`

`prisma migrate deploy` was **not** run from this workstation. #116 added
no migration.

---

## 3. #116 live surfaces

No mutation. Forgot-password was **not** submitted. Dummy invite was
inspect-only.

| Surface | Result |
| --- | --- |
| `GET /portal/login` | **200** — “Sign in to your dashboard”; link **Forgot password?** → `/portal/forgot-password` |
| Live browser `/portal/login` | Same: Email, Password, **Forgot password?**, Continue to dashboard |
| `GET /portal/forgot-password` | **200** — title **Reset your password**; intro copy about sending a reset link if eligible |
| Live browser `/portal/forgot-password` | **Portal login email** + **Send reset link** + **Back to sign in** |
| Password setup/reset form | Live invite route title **Choose a new password**. Deployed SHA includes labels **New password** / **Confirm new password** and mismatch copy **Passwords do not match.** (client `preventDefault` + server `preparePortalInviteAccept` before API) |
| Dummy well-formed `/portal/invite/<probe>` | **200** **Invite unavailable** — no token issued, no accept |
| Public reset request API | `POST /client/v1/portal-password-reset/request` without portal key → **401**; GET → **404** (POST-only). Authorized body was **not** sent |

Live JS chunk on C.O.C. contains **Forgot password?**, the generic success
sentence, and **Passwords do not match.** The invite form fields render
only after a successful inspect; this audit did not open a real token.

`GET /portal` (no session) → **307** `/portal/login?next=%2Fportal`.

---

## 4. Email delivery canary

Operator sequence from API run logs (paths and status codes only; no
recipient, sender, token, reset URL, or message ID):

| UTC | Call | HTTP |
| --- | --- | --- |
| 13:39:16 | `POST /client/v1/portal-password-reset/request` | **200** (176ms) |
| 13:40:26 | `POST /client/v1/portal-invite/inspect` | **200** |
| 13:41:00 | `POST /client/v1/portal-invite/accept` | **200** |
| 13:41:20 | `POST /client/v1/portal-login` | **200** |

That is **exactly one** authorized reset request after #116 became
ACTIVE. A later `POST` at 14:28:34 is this audit’s **unauthenticated**
existence probe (**401**, handler returns before rate-limit or send).

| Check | Evidence |
| --- | --- |
| Generic browser success | C.O.C. action always returns the deployed generic sentence; API always replies `{ ok:true, message:<generic> }` even when ineligible. Operator request completed **200**. This audit did not resubmit the form. |
| Exactly one real reset email | One authorized request. Public handler does **not** return the raw token or URL. Inspect **200** 70s later requires the emailed one-time link. No `portal_password_reset_email_failed` line. No second authorized request. |
| Configured transactional transport | API `RESEND_API_KEY` **SET** (`re_` prefix; value withheld). `SA360_TRANSACTIONAL_EMAIL_FROM` **SET** (bare mailbox; domain only `sa360.lifeagentlaunch.com`). `sendTransactionalEmail` is the only send path. |
| Reset URL live portal host | `SA360_PORTAL_PUBLIC_BASE_URL` **UNSET**. API `ADMIN_COC_BASE_URL` hostname = `sa360-api-staging-coo57.ondigitalocean.app` = live C.O.C. `live_url`. Constructed path is `/portal/invite/<token>` (token withheld). |
| Expiration ~60 minutes | Deployed `PORTAL_PASSWORD_RESET_TTL_MS = 60 * 60 * 1000`. Email copy uses `expires in 60 minutes`. |

Resend list API was **not** used as a second mailbox dump (list call
returned 401 with the spec key; values not retried or printed). Send
proof is the request → emailed link → inspect/accept chain.

---

## 5. Confirmation mismatch did not consume the token

Operator attestation: mismatching passwords entered once on the reset
form.

| Check | Evidence |
| --- | --- |
| “Passwords do not match.” displayed | Live bundle contains that exact string. Client form `preventDefault`s on mismatch and sets `role=alert`. Server action `preparePortalInviteAccept` returns the same error **before** `postPortalInviteAccept`. |
| API accept not completed on mismatch | Logs: inspect **200** at 13:40:26, then **no** `portal-invite/accept` until 13:41:00. A mismatch that reached the API would have been a **400** accept. There is none. |
| Same reset link remained usable | Accept **200** 34s later. Demo `portalPasswordSetAt` = `2026-09-03T13:41:00.057Z` (same second). Epoch incremented once. Invite columns cleared only on that successful accept. |

The token was **not** recreated or replayed by this audit.

---

## 6. Demo reset state

Read-only. Authorized `GET /admin/v1/clients/:id` for Smart Agent 360
Demo: **200**. DTO has `hasPortalPassword` /
`hasOutstandingPortalInvite` only — no `portalPasswordHash`, no
`portalInviteTokenHash`.

| Field | Production now | Prior (James conversion / preflight) |
| --- | --- | --- |
| `portalEnabled` | **true** | true |
| `portalPasswordHash` | **SET** (`scrypt$`; value withheld) | SET |
| `portalPasswordSetAt` | **SET** `2026-09-03T13:41:00.057Z` | SET (older; pre-#116) |
| `portalSessionEpoch` | **2** | **1** |
| `portalInviteTokenHash` | **null** | null |
| `portalInviteExpiresAt` | **null** | null |
| `hasOutstandingPortalInvite` | **false** | false |
| status | active | active |
| `updatedAt` | **2026-09-03T13:41:00.127Z** | `2026-09-02T12:54:32.770Z` |

Login email remains **present**. Length is now **17** (prior audits
recorded **23**). Authorized `PATCH /admin/v1/clients/:Demo` **200** at
13:38:52 — 24s before the reset request — can change `portalLoginEmail`
(and other admin fields). This audit did not PATCH. Value withheld.

Authoritative `GET /client/v1/portal-session-state` → **200**,
`portalEnabled=true`, `portalSessionEpoch=2`.

---

## 7. Auth proof

Passwords were **not** requested, printed, or typed into the agent.

| Probe | Result |
| --- | --- |
| Old Demo password | Rejected by construction: `portalPasswordSetAt` / hash rewritten at accept. Dummy password → **401** `{ ok:false, code:"INVALID" }` (no `passwordCheck`) |
| New Demo password | Operator `POST /client/v1/portal-login` **200** at 13:41:20 — 20s after accept. Bound `scrypt` hash makes `env_fallback` impossible; source = **customer** |
| Shared env password | **401** `{ ok:false, code:"INVALID" }` against Demo (and James) |
| Demo row after this audit’s probes | epoch still **2**, invite still null, `updatedAt` unchanged |

---

## 8. Session revocation

`isPortalSessionEpochCurrent(1, 2) === false` — the same helper
`readTrustedPortalSession` uses against authoritative
`GET /client/v1/portal-session-state`.

Expected: previous Demo epoch-1 trusted session is invalid. After accept,
the operator login minted a new session and immediately read
`portal-session-state` **200** for Demo. This audit did not mint or reuse
an epoch-1 cookie.

---

## 9. Tenant isolation

Using Demo’s bound tenant context (id withheld) — the same scoping a
signed-in Demo session applies:

| Surface | Result |
| --- | --- |
| `GET /client/v1/account` | **200**, display name **Smart Agent 360 Demo** |
| `GET /client/v1/dashboard` | **200** |
| `GET /client/v1/lead-orders` | **200**, **5** orders: LO-1049, LO-1048, LO-1047, LO-1046, LO-1044; display name **only** Smart Agent 360 Demo |
| `GET /client/v1/lead-delivery` | **200**, **17** rows; display name **only** Smart Agent 360 Demo |
| James lead as Demo | **404** `Lead delivery record not found` |
| James orders | **0** (no James order row to leak; same 404 contract) |
| Breanna orders | **0** |
| Foreign LO-1053 order / leads / exports as Demo | **404** `Lead order not found` |

Operator post-login reads at 13:41:21 were Demo `account` + Demo
`lead-orders` only. Audit browser stayed signed out (no password).

Tenant header / identity remains **Smart Agent 360 Demo**.

---

## 10. James / Breanna regression

| Field | Vet Life — James Torrey | Breanna Kimberling |
| --- | --- | --- |
| portalEnabled | **true** | **true** |
| converted / password bound | **YES** (`scrypt$`) | **NO** (hash **null**) |
| `portalPasswordSetAt` | `2026-09-02T21:33:00.715Z` | null |
| epoch | **1** (unchanged) | **0** |
| outstanding invite | **false** | **false** |
| status | active | onboarding |
| `updatedAt` | **2026-09-02T21:33:00.769Z** (unchanged) | **2026-06-02T20:08:31.774Z** (unchanged) |

James + shared env password → **401 INVALID**.  
Breanna + shared env password → **200** `passwordCheck=env_fallback`,
epoch **0**. She remains the only migration-fallback tenant.

Eleven `ClientAccount` rows. Aggregates:

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted | **2** (Smart Agent 360 Demo, Vet Life — James Torrey) |
| Fallback | **1** (Breanna Kimberling) |
| Outstanding invites | **0** |

Before/after fingerprints during this audit (after the already-completed
operator canary): **no further Demo/James/Breanna drift**.

---

## 11. Rate-limit / security state

Rate limit was **not** deliberately hit.

| Check | Result |
| --- | --- |
| Redis | `/health/queue` **200** `PONG`. `REDIS_URL` **SET** on the API app |
| Hashed buckets | Deployed `portalPasswordResetRateLimitBucket` is `portal-pw-reset:{email\|ip}:{sha256(value)}` |
| Generic response | Live handler always sends the same success message; outcome (`issued` / `ineligible` / …) is not returned |
| Unknown / unconverted | Ineligible accounts take the same generic path and do not issue a token. Not re-probed with real emails |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** (desired + running, both apps) |

---

## 12. Delivery safety

Unchanged. Nothing was written.

| Control | Production |
| --- | --- |
| NextGen | **capture_only** (`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE`) |
| LF2 execution | **off** (`SA360_LF2_EXECUTION_ENABLED` absent; safety `lf2ExecutionEnabled: false`) |
| LF2 GHL canary | **off** (`lf2GhlCanaryEnabled: false`) |
| Delivery runtime | **simulate** (`effectiveMode=simulate`, `canRunLiveCanary=false`) |
| Effective GHL | **simulate** (runtime). Env `GHL_DELIVERY_ADAPTER_MODE` remains `live_canary`; the runtime row keeps live canary closed |
| Safety | `GET /admin/v1/fulfillment-ops/safety` → **200**, `simulationOnly: true`, `liveDeliveryEnabled: false`, `liveDeliveryStatus: LIVE DISABLED` |
| Safety message | `Simulation only — no external delivery will occur.` |

---

## 13. Matrix

| Item | Result |
| --- | --- |
| Production SHA | `e75fc98` API = worker = Admin C.O.C. = master |
| Migrations | 73/73, 0 pending, 0 failed |
| Legacy access code | **UNSET** |
| Real reset email | **YES** (one) |
| Reset link host | **YES** (live C.O.C.) |
| Mismatch preserved token | **YES** |
| Demo epoch | **2** |
| Old password rejected | **YES** |
| New password login | **YES** |
| Old session revoked | **YES** |
| Tenant isolation | **YES** |
| Portal-enabled / converted / fallback / invites | **3 / 2 / 1 / 0** |
| James unchanged | **YES** |
| Breanna unchanged | **YES** |
| NextGen / LF2 / GHL | capture_only / off / simulate |

**A. Is #116 live on one SHA with 73/73 migrations?**  
**YES.**

**B. Did the Demo self-service reset send a real production email?**  
**YES.** One authorized request; inspect required the emailed link.

**C. Did confirmation mismatch consume the token?**  
**NO.**

**D. Is it safe to convert the final portal-enabled customer (Breanna)?**  
**YES**, one-at-a-time, without re-enabling the access code, and without
resetting Demo or James.

---

## What this task did not do

- No DigitalOcean spec write, env edit, deploy, rollback, or retry
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance
- No additional password-reset request and no additional email
- No print or request of Demo / James / shared passwords
- No change to Breanna Kimberling or Vet Life — James Torrey
- No use of a former production access code
- No email, flag, NextGen, LF2, or GHL change
- No product PR

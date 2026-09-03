# SA360 portal password recovery production config preflight — 2026-09-02

Read-only production configuration check for PR #116 self-service portal
password recovery. Started from current `origin/master`.

No environment variable was changed. No deploy was triggered. No email was
sent. No password reset was requested. No portal invite was issued. Demo
and James were not reset. Breanna Kimberling was not converted. No
production row was written. Secret values (API keys, FROM mailbox local
part, hashes, login emails, tokens, session secrets) are never printed in
this file.

**Audit window:** 2026-09-02T22:36Z–22:38Z (UTC)  
**Git baseline:** `origin/master` = `075068f0ce3d259c1b970b9ae035653523b1225d`  
**PR under test (not merged):** [#116](https://github.com/BirdofRain/sa360/pull/116)
`feat(portal): add password confirmation and secure recovery`  
**Method:** DigitalOcean App Platform metadata (`doctl` read only), public
and authorized HTTP reads, Prisma `SELECT` / `COUNT` with
`default_transaction_read_only = on`.

Local `master` is documentation-only commits ahead of / diverged from
`origin/master`. Production code SHA is the `origin/master` tip.

---

## FINAL VERDICT

**GREEN — PRODUCTION CONFIG READY FOR PR #116**

The API process that will send password-reset email already has both
Resend variables at runtime, plus a usable public portal base URL. That
base is `ADMIN_COC_BASE_URL` (fallback after unset
`SA360_PORTAL_PUBLIC_BASE_URL`) and it is the current live production
Admin C.O.C. / `/portal` host. PR #116 would construct reset links as
`https://sa360-api-staging-coo57.ondigitalocean.app/portal/invite/<token>`.
The word `staging` in that hostname is historical App Platform naming
only.

No additional production environment variable is required. Do not change
these values as part of merging #116. Do not convert Breanna. Do not
reset Demo or James. Do not send a test reset email from this audit.

---

## Return card

| Item | Result |
| --- | --- |
| `RESEND_API_KEY` | **SET** (sa360 app-level → inherited by `sa360-api`; also SET on Admin C.O.C.) |
| `SA360_TRANSACTIONAL_EMAIL_FROM` | **SET** (bare mailbox; domain `sa360.lifeagentlaunch.com`; same components) |
| `SA360_PORTAL_PUBLIC_BASE_URL` | **UNSET** |
| `ADMIN_COC_BASE_URL` | **SET** on API only — `https://sa360-api-staging-coo57.ondigitalocean.app` |
| API has required mail config? | **YES** |
| Reset link base resolves to live portal? | **YES** |
| Any additional production config required? | **NO** |
| **FINAL VERDICT** | **GREEN — PRODUCTION CONFIG READY FOR PR #116** |

---

## 1. Current baseline

`origin/master` = `075068f0ce3d259c1b970b9ae035653523b1225d`  
`fix(portal): harden login email editing and leads filter navigation (#115)`

| Component | App | Active deploy | Cause | Source SHA | vs origin/master |
| --- | --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` `2c381355-37a1-415f-bf06-ad477add164e` | `45e31c52` **ACTIVE** | commit `075068f` | `075068f` | **MATCH** |
| Worker (`sa360-worker`) | same | same | same | `075068f` | **MATCH** |
| migrate (`sa360-migrate`) | same | same | same | `075068f` | **MATCH** |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` | `37c3a425` **ACTIVE** | commit `075068f` | `075068f` | **MATCH** |

No in-progress deployment. No new `ERROR` on the live train. Fleet is still
**ONE SHA**. These are the same active deploy IDs as the James conversion
audit earlier today.

Live `GET /health` and authorized `GET /admin/v1/health` both report
`commitSha=075068f0ce3d259c1b970b9ae035653523b1225d`.

API origin: `https://sa360-sw6oq.ondigitalocean.app`  
Admin C.O.C. / portal: `https://sa360-api-staging-coo57.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitShort=075068f` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` (Redis reachable; #116 rate-limit can use existing Redis) |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |
| `GET /portal/login` | **200** | live portal login |
| `GET /portal/invite` | **200** | reset-link route exists on current master |
| `GET /portal/invite/preflight-probe-do-not-use` | **200** | page exists; **no** invite issued |

`CLIENT_PORTAL_ACCESS_CODE` = **UNSET** on API desired spec, API running
spec, Admin C.O.C. desired spec, and Admin C.O.C. running spec
(`37c3a425`). Admin C.O.C. app-level env key count remains **47**.

Repository migrations: **73**. Production `_prisma_migrations` (SELECT
only, `default_transaction_read_only = on`):

Host (masked): `sa360-postgres-do-user-1494645-….ondigitalocean.com:25060`
database `defaultdb`.

| Metric | Count |
| --- | --- |
| Applied (`finished_at` set, not rolled back) | **73** |
| Pending vs repository | **0** |
| Failed / unfinished | **0** |

Latest two unchanged since post-#114 PRE_DEPLOY
(`20260831190000_…` / `20260831210000_…`, applied
2026-09-01T18:10:36Z). `prisma migrate deploy` was **not** run from this
workstation. PR #116 adds no migration.

**Baseline did not drift. Audit continued.**

---

## 2. Email configuration

Inspected desired and running specs for both apps. Presence only. Values
never printed.

PR #116 sends reset mail from the **API** via existing
`sendTransactionalEmail` / `isTransactionalEmailConfigured()`. Those
functions read `process.env` on the API process only:

- `RESEND_API_KEY` (trimmed, non-empty)
- `SA360_TRANSACTIONAL_EMAIL_FROM` (trimmed, non-empty)

A variable that exists only on Admin C.O.C. or only on the worker would
**not** count. That is not the case here.

| Variable | sa360 app-level | `sa360-api` service override | `sa360-worker` override | admin-coc desired | admin-coc running `37c3a425` |
| --- | --- | --- | --- | --- | --- |
| `RESEND_API_KEY` | **SET** (`RUN_AND_BUILD_TIME`) | none (inherits app) | none (inherits app) | **SET** | **SET** |
| `SA360_TRANSACTIONAL_EMAIL_FROM` | **SET** (`RUN_AND_BUILD_TIME`) | none (inherits app) | none (inherits app) | **SET** | **SET** |

`sa360-api` service-level keys are only
`SA360_BUILD_COMMIT_SHA`, `SA360_BULK_SOURCE_IMPORTS_ENABLED`,
`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE`, `SA360_PPL_CSV_EXPORT_ENABLED`,
`SA360_PPL_SELECTION_ENABLED`. None of those shadow the mail variables.

DigitalOcean App Platform injects app-level envs into every component.
Because the keys are on the **sa360** app spec at runtime scope, the
`sa360-api` process that will call Resend can read them. Admin C.O.C.
also has copies; those are **not** the send path for #116.

`RESEND_API_KEY` shape (value withheld): starts with `re_` on both apps
(Resend live/test key prefix). Type in the spec is `GENERAL`, not
`SECRET` — hygiene only, not a missing-config hold.

`SA360_TRANSACTIONAL_EMAIL_FROM` shape (value withheld): **bare mailbox**
(`local@domain`, not `Name <local@domain>`). Domain only:
`sa360.lifeagentlaunch.com`. Length 33. The transport does not require
the display-name form; it passes the trimmed string to Resend as `from`.

`SUPPORT_TICKET_NOTIFY_ENABLED` = **true** on the API app (value is a
non-secret flag). That means production already intends to use this same
Resend transport for C.O.C. support tickets. This audit still did **not**
send mail, so Resend domain verification is not proven at send-time.

---

## 3. Portal reset base URL

| Variable | sa360 (API) desired | sa360 (API) running | admin-coc desired | admin-coc running |
| --- | --- | --- | --- | --- |
| `SA360_PORTAL_PUBLIC_BASE_URL` | **UNSET** | **UNSET** | **UNSET** | **UNSET** |
| `ADMIN_COC_BASE_URL` | **SET_HTTPS** host `sa360-api-staging-coo57.ondigitalocean.app` | same | **UNSET** | **UNSET** |

`ADMIN_COC_BASE_URL` lives on the **API** app, which is the process that
builds the reset link. It is correctly **absent** from Admin C.O.C.

Current master (and PR #116, which reuses it):

```
resolvePortalPublicBaseUrl()
  = SA360_PORTAL_PUBLIC_BASE_URL || ADMIN_COC_BASE_URL
buildAbsoluteOrRelativePortalUrl("/portal/invite/<token>")
issuePortalInvite() → that URL
```

PR #116 `canDeliverPortalPasswordResetEmail()` refuses to issue a token
unless `resolvePortalPublicBaseUrl()` returns a host **and** transactional
email is configured. With the former UNSET, the usable option is API
`ADMIN_COC_BASE_URL`.

Live Admin C.O.C. `live_url` / `default_ingress` =
`https://sa360-api-staging-coo57.ondigitalocean.app`. `spec.domains` =
**[]**. That hostname **is** the production portal host. The `staging`
token is cosmetic naming only (same finding as the post-#115 smoke).

Constructed reset link (token placeholder only; no token issued):

`https://sa360-api-staging-coo57.ondigitalocean.app/portal/invite/<token>`

That host equals the live C.O.C. origin. `GET /portal/invite` on that
host returns **200**. After #116, self-service copy on the same route is
“Choose a new password for your portal.” Operator-issued invites keep
the same path.

`/portal/forgot-password` is **not** live on current master (expected).
Unauthenticated GET today **307**s to
`/portal/login?next=%2Fportal%2Fforgot-password` because #116 has not
been deployed. That is a code-deploy item, not a missing env var.

---

## 4. Email transport readiness

Inspected current `origin/master` `apps/api/src/lib/transactional-email.ts`
and PR #116 `portal-password-reset.service.ts` /
`portal-password-reset-email.ts`.

| Question | Answer |
| --- | --- |
| Can `sendTransactionalEmail` use the production Resend configuration? | **YES** — API process has `RESEND_API_KEY` (`re_` prefix) and `SA360_TRANSACTIONAL_EMAIL_FROM` at `RUN_AND_BUILD_TIME` |
| Does the configured FROM satisfy the transport? | **YES** — non-empty trimmed mailbox; code has no extra format check; Resend accepts a bare `from` |
| Additional env var required by the code? | **NO** — only those two plus a public base URL |
| Does #116 rely on a variable unavailable to the API? | **NO** — mail + `ADMIN_COC_BASE_URL` are on the sa360 app spec inherited by `sa360-api` |
| Redis / rate limit extra config? | **NO** — existing `REDIS_URL` is SET on the API app; `/health/queue` = PONG. #116 fails closed if Redis is down |

If mail or the public base URL were missing, #116 would return the
generic success message and **not** issue a token (so an outstanding
operator invite would not be invalidated). That guard would **not** fire
on current production config.

No real test email was sent.

---

## 5. Customer state

Read only. Eleven `ClientAccount` rows. Before/after fingerprints during
this audit: **no drift**.

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted (`portalPasswordHash` not null) | **2** |
| Shared-env fallback | **1** |
| Outstanding invites | **0** |

| Safe display name | portalEnabled | login email? | hasPortalPassword | epoch | invite | status | `updatedAt` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Smart Agent 360 Demo | true | yes | **true** (`scrypt$`) | **1** | no | active | 2026-09-02T12:54:32.770Z |
| Vet Life — James Torrey | true | yes | **true** (`scrypt$`) | **1** | no | active | 2026-09-02T21:33:00.769Z |
| Breanna Kimberling | true | yes | false | 0 | no | onboarding | 2026-06-02T20:08:31.774Z |

Converted accounts: **Smart Agent 360 Demo**, **Vet Life — James Torrey**.  
Unconverted: **Breanna Kimberling**.

After #116 deploys, self-service reset is eligible only for converted,
portal-enabled accounts (Demo and James). Breanna would receive the same
generic success and no email / no token. This audit did not request a
reset for anyone.

---

## 6. Result

| Item | Result |
| --- | --- |
| `RESEND_API_KEY` | **SET** on API (and Admin C.O.C.) |
| `SA360_TRANSACTIONAL_EMAIL_FROM` | **SET** on API (and Admin C.O.C.); bare mailbox @ `sa360.lifeagentlaunch.com` |
| `SA360_PORTAL_PUBLIC_BASE_URL` | **UNSET** |
| `ADMIN_COC_BASE_URL` | **SET** on API → live C.O.C. host |
| API has required mail config? | **YES** |
| Reset link base resolves to live portal? | **YES** |
| Any additional production config required? | **NO** |

**FINAL VERDICT:**  
**GREEN — PRODUCTION CONFIG READY FOR PR #116**

Residual (not a config hold): this task did not send mail, so Resend
account/domain verification is not proven at send-time. The SA360 env
surface required by the code is complete on the API component.

---

## What this task did not do

- No DigitalOcean spec write, env edit, deploy, rollback, or retry
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance
- No password-reset request and no email
- No change to Breanna Kimberling, Smart Agent 360 Demo, or James
- No use of a former production access code
- No product PR

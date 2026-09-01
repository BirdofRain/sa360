# SA360 post-#114 production deployment verification — 2026-09-01

Read-only production verification after merge of PR #114 (production `tsc`
unblock). Started from current `origin/master`.

No deploy was triggered or retried. No `prisma migrate deploy` was run by
hand. No env changes. No portal invite issued. No customer password set. No
customer converted. No email sent. No PPL / LF2 / NextGen / GHL flags
changed. No production rows were written. `?access=` was not exercised.
Secret values are never printed in this file.

**Audit window:** 2026-09-01T18:06Z–18:15Z (UTC)  
**Git baseline:** `origin/master` = `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`  
**Method:** DigitalOcean App Platform metadata (`doctl`, no writes), public
and authorized admin / portal HTTP reads, Prisma `SELECT` / `COUNT` against
production Postgres with `default_transaction_read_only = on`.

**Before #114 (from the 2026-09-01 auth preflight on branch
`docs/production-auth-preflight-2026-09-01`):**

- `origin/master` = `42ce113`
- Admin C.O.C. MATCH `42ce113`
- API / worker / migrate stuck at `164fbbb`
- production `_prisma_migrations` = 71/73
- auth UI ahead of backend/database
- root cause: production `pnpm build:api` / `tsc` failure on test fixtures

---

## FINAL VERDICT

**GREEN — AUTH CHAIN DEPLOYED, READY FOR LEGACY ACCESS-CODE CUTOVER**

DigitalOcean auto-deploy after `#114` recovered the `sa360` train. API,
worker, migrate, and Admin C.O.C. are all **ACTIVE** on current master
`5c92ece`. PRE_DEPLOY `sa360-migrate` applied migrations 72 and 73. Live
`/health` reports the same SHA. Portal login / session-state / invite
inspect+accept / admin invite-issue routes exist on the live API. Auth
columns exist. All three portal-enabled tenants remain unconverted on
shared-env fallback. `CLIENT_PORTAL_ACCESS_CODE` is still SET on C.O.C. and
remains the final auth cutover blocker.

Do **not** convert customers until that legacy access code is disabled.

---

## 1. Master

| Item | Value |
| --- | --- |
| `origin/master` SHA | `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4` |
| Message | `fix(build): type API test fixtures for production tsc (#114)` |
| PR #114 | **MERGED** 2026-09-01T18:06:25Z — https://github.com/BirdofRain/sa360/pull/114 |
| #114 present on master | **YES** (tip commit) |
| Repository migration count | **73** |

#114 changes only API test/fixture typing (no product behavior):

- `apps/api/src/services/ppl-fulfillment/integrated-50-lead-beta-regression.fixtures.ts`
- `apps/api/src/services/client-onboarding.present.test.ts`

Expected portal-auth migrations still in the repository (72nd and 73rd):

- `20260831190000_client_account_portal_password_foundation`
- `20260831210000_client_account_portal_invite`

Local `master` was fast-forwarded `42ce113` → `5c92ece` for this audit only.

---

## 2. DigitalOcean deployment

Apps (read-only):

- `sa360` `2c381355-37a1-415f-bf06-ad477add164e` — API + worker + migrate
- `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` — Admin C.O.C. + portal

`#114` merge triggered auto-deploy on both apps (`cause=commit 5c92ece pushed
to github.com/BirdofRain/sa360/tree/master`). This audit did not create,
retry, or cancel either deployment. Both were observed from BUILDING through
a terminal **ACTIVE** state.

| Component | App | Deploy ID | Phase (terminal) | Source SHA |
| --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` | `97744d5e-e485-42c8-9e5f-7134a610151f` | **ACTIVE** | `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4` |
| Worker (`sa360-worker`) | `sa360` | same | **ACTIVE** | `5c92ece` |
| migrate (`sa360-migrate`, `kind: PRE_DEPLOY`) | `sa360` | same | **SUCCESS** then app **ACTIVE** | `5c92ece` |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` | `19600345-4aa7-4f9a-b67e-7518ae1c2e08` | **ACTIVE** | `5c92ece` |

Timeline (`sa360` `97744d5e`):

| Time (UTC) | Event |
| --- | --- |
| 18:06:25 | #114 merged |
| 18:06:28 | deploy created (`BUILDING`) |
| 18:06:33–18:09:52 | build **SUCCESS** (API + worker + migrate) |
| 18:10:00 | deploy step started; migrate job **RUNNING** while API/worker **PENDING** |
| 18:10:32–18:10:36 | `pnpm migrate:deploy` applied 72 + 73 |
| 18:11:48 | phase **ACTIVE**; API + worker + migrate **SUCCESS** |

`sa360-admin-coc` `19600345`: created 18:06:27, build SUCCESS 18:10:29,
**ACTIVE** 18:11:39.

Previous live `sa360` deploy `d5b20dfe` (`164fbbb`, 2026-08-31) is no longer
the active deployment. Previous live C.O.C. deploy `0f806839` (`42ce113`) is
no longer the active deployment.

No `ERROR`. No in-progress deployment remains.

### Why the train recovered

Read-only API build log for `97744d5e` (`doctl apps logs --type build`):

- checkout `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`
- custom command `pnpm build:api` → `tsc -p tsconfig.json` for `@sa360/api`
- **build complete** (no fixture / `ghlDestination` / `InputJsonValue` errors)

That is the exact failure class that kept every `sa360` deploy after #106 at
`164fbbb`.

---

## 3. Migrate gate

`sa360-migrate` is App Platform `kind: PRE_DEPLOY`, run command
`pnpm migrate:deploy`. Job source SHA = `5c92ece`. Deploy step order was
migrate **RUNNING** before API/worker left PENDING.

PRE_DEPLOY run log (read-only):

```
> prisma migrate deploy
Datasource "db": PostgreSQL database "defaultdb" ... ondigitalocean.com:25060
73 migrations found in prisma/migrations
Applying migration `20260831190000_client_account_portal_password_foundation`
Applying migration `20260831210000_client_account_portal_invite`
All migrations have been successfully applied.
```

Production `_prisma_migrations` (SELECT only, `default_transaction_read_only
= on`):

Host (masked): `sa360-postgres-do-user-1494645-0.k.db.ondigitalocean.com:25060`
database `defaultdb`.

| Metric | Count |
| --- | --- |
| Applied (`finished_at` set, not rolled back) | **73** |
| Pending vs repository 73 | **0** |
| Failed / unfinished | **0** |

| Migration | Production |
| --- | --- |
| `20260831190000_client_account_portal_password_foundation` | **applied** `finished_at=2026-09-01T18:10:36.634Z` `applied_steps_count=1` |
| `20260831210000_client_account_portal_invite` | **applied** `finished_at=2026-09-01T18:10:36.653Z` `applied_steps_count=1` |

API became ACTIVE **after** these rows existed (migrate 18:10:36, ACTIVE
18:11:48). The “API ACTIVE before 72/73 exist → RED” stop condition did
**not** fire.

`prisma migrate deploy` was **not** run from this workstation.

---

## 4. SHA consistency

Required: API = worker = Admin C.O.C. = current master.

| Component | Production SHA | vs `origin/master` `5c92ece` |
| --- | --- | --- |
| API | `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4` | **MATCH** |
| Worker | `5c92ece` | **MATCH** |
| Admin C.O.C. | `5c92ece` | **MATCH** |
| migrate | `5c92ece` (job `source_commit_hash`) | **MATCH** |

`GET /health` and authorized `GET /admin/v1/health` both report
`commitSha=5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`,
`buildSource=SA360_BUILD_COMMIT_SHA`.

**Fleet status: ONE SHA.** No mixed-version state.

---

## 5. Health

API origin: `https://sa360-sw6oq.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitShort=5c92ece` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |

Public C.O.C. / portal origin:
`https://sa360-api-staging-coo57.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /portal/login` | **200** | HTML only; not logged in |
| `GET /portal/invite` | **200** | route exists |
| `GET /portal/invite/post114-probe-do-not-use` | **200** | page exists; **no** invite issued |

Legacy `?access=` was **not** exercised.

---

## 6. Portal auth capability

Safe existence / schema probes only. **No** valid admin invite issuance
request (even with admin key). Dummy inspect/accept tokens only.

Live API now supports the #109/#111/#112 contracts:

| Probe | Result | Meaning |
| --- | --- | --- |
| `POST /admin/v1/clients/:id/portal-invite` without admin key | **401** `{ ok:false, error:"Unauthorized" }` | issue route exists; no record created |
| `POST /client/v1/portal-login` without portal key | **401** | login route exists |
| `POST /client/v1/portal-login` authorized, empty body | **400** | schema: `loginEmail` + `password` required |
| `GET /client/v1/portal-session-state` without key | **401** | session-state route exists |
| `GET /client/v1/portal-session-state` authorized, no query | **400** | schema: `clientAccountId` required |
| `GET /client/v1/portal-session-state?clientAccountId=<portal tenant>` | **200** | `{ ok:true, portalSessionEpoch:0, portalEnabled:true }` (id withheld) |
| `POST /client/v1/portal-invite/inspect` dummy token | **400** | `code=INVITE_INVALID` (generic; no record) |
| `POST /client/v1/portal-invite/accept` dummy token | **400** | `code=INVITE_INVALID` (generic; no conversion) |

On `164fbbb` these paths did not exist (preflight: no `portal-invite` /
`portal-login` / `portal-session-state` on the live API). They do now.

`ClientAccount` production columns **present**:

- `portalPasswordHash`
- `portalPasswordSetAt`
- `portalSessionEpoch`
- `portalInviteTokenHash`
- `portalInviteExpiresAt`

Invite public-URL capability: **SET**. `ADMIN_COC_BASE_URL` on the API app
is an `https://` origin. `SA360_PORTAL_PUBLIC_BASE_URL` remains UNSET.
`buildAbsoluteOrRelativePortalUrl()` uses the latter then the former, so
generated invite links would be absolute C.O.C. URLs. No invite was issued
to prove that.

---

## 7. Portal customer state

Read only. `ClientAccount` only. Login emails withheld.

| Metric | Count |
| --- | --- |
| Portal-enabled accounts | **3** |
| Converted password (`portalPasswordHash` not null) | **0** |
| Outstanding invites (`portalInviteTokenHash` not null) | **0** |
| Still shared-env fallback | **3 of 3** |

| Safe display name | portalEnabled | login email? | hasPortalPassword | portalSessionEpoch | outstanding invite | status |
| --- | --- | --- | --- | --- | --- | --- |
| Breanna Kimberling | true | yes | false | 0 | no | onboarding |
| Smart Agent 360 Demo | true | yes | false | 0 | no | active |
| Vet Life — James Torrey | true | yes | false | 0 | no | active |

Eleven `ClientAccount` rows total. The other eight remain portal-disabled
(including Lead Agent and Smart Test Agent). Unchanged from the pre-#114
preflight except that auth columns now exist and are empty/default.

No account was converted.

---

## 8. Legacy access code

Presence only. Value not printed. `?access=` not opened.

| Variable | sa360 (API/worker) | admin-coc |
| --- | --- | --- |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** | **SET** |

Current master (and the live C.O.C. SHA `5c92ece`) still grants a v1 legacy
session from a valid `?access=`
(`apps/admin-coc/src/app/portal/page.tsx` → `isValidPortalAccessCode` →
`createLegacyPortalSessionToken()`).

Env-fallback tenant bind is still incomplete: `CLIENT_PORTAL_CLIENT_ACCOUNT_ID`
is **SET** on the API app and **UNSET** on C.O.C. The env tenant remains
Lead Agent (portal disabled, no login email) — not one of the three
portal-enabled customers.

**Recommendation: DISABLE BEFORE CUSTOMER CONVERSION**

No new evidence contradicts the pre-#114 recommendation. The code path is
still armed. Disable `CLIENT_PORTAL_ACCESS_CODE` before converting paying
tenants.

---

## 9. Delivery safety

Unchanged. Nothing was written.

| Control | Production |
| --- | --- |
| NextGen | **capture_only** (`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` SET to that value) |
| LF2 execution | **off** (`SA360_LF2_EXECUTION_ENABLED` absent; safety `lf2ExecutionEnabled: false`) |
| LF2 GHL canary | **off** (`lf2GhlCanaryEnabled: false`, allowlists unset) |
| Delivery runtime | **simulate** (`GET /admin/v1/delivery-runtime-mode` → `effectiveMode=simulate`, `canRunLiveCanary=false`) |
| Effective GHL | **simulate** (runtime). Env `GHL_DELIVERY_ADAPTER_MODE` / `MAX_MODE` remain `live_canary`; the runtime row keeps live canary closed. |
| Safety message | `Simulation only - no external delivery will occur.` |

`GET /admin/v1/fulfillment-ops/safety` → **200**, `simulationOnly: true`,
`liveDeliveryEnabled: false`.

Unrelated, still true: `SA360_PPL_SELECTION_ENABLED=true` and
`SA360_PPL_CSV_EXPORT_ENABLED=true`. Not changed here.

---

## 10. Auth environment (presence only)

Same shape as the pre-#114 preflight. **No values.**

| Variable | sa360 (API/worker) | admin-coc | Rollup |
| --- | --- | --- | --- |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | UNSET | SET | **SET** (C.O.C. only; #109 BFF-verify design) |
| `CLIENT_PORTAL_SESSION_SECRET` | UNSET | SET | **SET** |
| `CLIENT_PORTAL_API_KEY` | SET | SET | **SET** (both apps) |
| `CLIENT_PORTAL_ACCESS_CODE` | UNSET | SET | **SET** (C.O.C. only) |
| `CLIENT_PORTAL_LOGIN_EMAIL` | UNSET | SET_EMAIL_SHAPED | **SET** (value withheld) |
| `CLIENT_PORTAL_CLIENT_ACCOUNT_ID` | SET | UNSET | **MISMATCH** (unchanged) |
| `SA360_PORTAL_PUBLIC_BASE_URL` | UNSET | UNSET | **UNSET** |
| `ADMIN_COC_BASE_URL` | SET_HTTPS | UNSET | **SET** (API; usable for invite URLs) |

---

## 11. Final matrix

| Component | SHA | Status | Migration-compatible | Ready? |
| --- | --- | --- | --- | --- |
| API | `5c92ece` | **ACTIVE** | **YES** (73/73) | **YES** |
| Worker | `5c92ece` | **ACTIVE** | **YES** | **YES** |
| Admin C.O.C. | `5c92ece` | **ACTIVE** | n/a | **YES** |
| migrate | `5c92ece` | PRE_DEPLOY **SUCCESS** | **YES** (72 + 73 applied) | **YES** |

**A. Did #114 restore the deploy train?**  
**YES.** Auto-deploy of `5c92ece` built, migrated, and reached ACTIVE on
`sa360` and `sa360-admin-coc`. The production `tsc` blocker is gone.

**B. Are API/worker/admin on one SHA?**  
**YES.** All three plus migrate = `5c92ece` = current `origin/master`.

**C. Did migrate apply 72 + 73?**  
**YES.** Both names exist in `_prisma_migrations` with `finished_at` set.
Applied 73, pending 0, failed 0.

**D. Is production auth backend now compatible with live C.O.C.?**  
**YES.** Login, session-state, invite inspect/accept, and admin invite-issue
routes exist on the live API. Required columns exist. C.O.C. invite/login UI
is no longer ahead of the backend/database.

**E. Are all three portal tenants still unconverted?**  
**YES.** Converted password count = 0. Outstanding invites = 0. All remain
on shared fallback.

**F. Is legacy access code still the final auth cutover blocker?**  
**YES.** `CLIENT_PORTAL_ACCESS_CODE` is still SET on C.O.C. Disable it
before one-at-a-time customer conversion.

### Remaining operator action (not done by this audit)

1. Disable `CLIENT_PORTAL_ACCESS_CODE` on Admin C.O.C. before converting
   paying tenants.
2. Then — and only then — one-at-a-time portal invite / password conversion.

No product PR. No production writes.

---

## What this audit did not do

- No DigitalOcean deploy / rollback / retry / env edit
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance (admin issue path probed without a key only)
- No password set or customer conversion
- No `?access=` URL visit
- No email, flag, NextGen, LF2, or GHL change
- No product PR

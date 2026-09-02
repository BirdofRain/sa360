# SA360 first production portal conversion — Smart Agent 360 Demo — 2026-09-01/02

Read-only production verification after the operator manually converted
**only** Smart Agent 360 Demo with the production C.O.C. one-time portal
invite flow.

Started from current `origin/master`. No invite was issued. No password was
reset or printed. No customer record was written by this audit. No
environment variable was changed. No deploy was triggered. No migration was
run. No email was sent. No fulfillment flag was changed. No other tenant
was converted. Secret values (passwords, hashes, session secrets, API keys,
invite tokens, login emails) are never printed in this file.

**Audit window:** 2026-09-02T13:24Z–13:36Z (UTC)  
**Git baseline:** `origin/master` = `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`  
**Method:** DigitalOcean App Platform metadata (`doctl` read only), public
and authorized HTTP reads, Prisma `SELECT` / `COUNT` with
`default_transaction_read_only = on`, synthetic `?access=` probe, and
operator-attested Demo password login (password never entered into the
agent).

Local `master` is documentation-only commits ahead of `origin/master`.
Production code SHA is the `origin/master` tip.

---

## FINAL VERDICT

**GREEN — DEMO PORTAL CONVERSION PROVEN, READY FOR FIRST REAL CUSTOMER**

Smart Agent 360 Demo is the only converted portal tenant: per-customer
`scrypt` password bound, `portalSessionEpoch = 1`, invite consumed. The
legacy shared env password is rejected for Demo (`401 INVALID`) and still
works as `env_fallback` for the two unconverted portal tenants. Tenant
reads stay scoped. Delivery remains simulate. Convert paying tenants one
at a time. Do not re-set `CLIENT_PORTAL_ACCESS_CODE`. Do not issue a
second Demo invite merely to test replay.

---

## Return card

| Item | Result |
| --- | --- |
| Production SHA | `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4` (API = worker = Admin C.O.C. = master) |
| Migrations | **73** applied / **0** pending / **0** failed |
| Legacy access code | **UNSET** |
| Portal-enabled total | **3** |
| Converted total | **1** (Smart Agent 360 Demo) |
| Fallback total | **2** |
| Outstanding invites | **0** |
| Smart Agent 360 Demo — password set? | **YES** (`hasPortalPassword=true`, `portalPasswordSetAt` set, `scrypt` format) |
| Smart Agent 360 Demo — session epoch | **1** |
| Smart Agent 360 Demo — invite consumed? | **YES** (hash null, expiry null, `hasOutstandingPortalInvite=false`) |
| Smart Agent 360 Demo — new password login | **PASS** (`customer`; see §4) |
| Smart Agent 360 Demo — shared-password rejection | **PASS** (`401 INVALID`) |
| Smart Agent 360 Demo — portal access | **PASS** |
| Smart Agent 360 Demo — tenant isolation | **PASS** (foreign order/leads/exports **404**) |
| Other tenants unchanged? | **YES** |

---

## 1. Production baseline

`origin/master` = `5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`  
`fix(build): type API test fixtures for production tsc (#114)`

| Component | App | Active deploy | Cause | Source SHA | vs origin/master |
| --- | --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` `2c381355-37a1-415f-bf06-ad477add164e` | `97744d5e` **ACTIVE** | commit `5c92ece` | `5c92ece` | **MATCH** |
| Worker (`sa360-worker`) | same | same | same | `5c92ece` | **MATCH** |
| migrate (`sa360-migrate`) | same | same | same | `5c92ece` | **MATCH** |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` | `de741efc` **ACTIVE** | **app spec updated** | `5c92ece` | **MATCH** |

No in-progress deployment. No `ERROR`. Fleet is still **ONE SHA**.

Live `GET /health` and authorized `GET /admin/v1/health` both report
`commitSha=5c92ece7a0870f2b56e56139d6c45c5fe5ef23a4`.

API origin: `https://sa360-sw6oq.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitShort=5c92ece` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |

`CLIENT_PORTAL_ACCESS_CODE` = **UNSET** on API desired spec, Admin C.O.C.
desired spec, and the running Admin C.O.C. deploy spec (`de741efc`).
Admin C.O.C. app-level env key count remains **47**.

Required login configuration remains SET (presence only):

| Variable | sa360 (API/worker) | admin-coc desired | admin-coc running |
| --- | --- | --- | --- |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** | **UNSET** | **UNSET** |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | UNSET | **SET** | **SET** |
| `CLIENT_PORTAL_SESSION_SECRET` | UNSET | **SET** | **SET** |
| `CLIENT_PORTAL_API_KEY` | **SET** | **SET** | **SET** |
| `CLIENT_PORTAL_LOGIN_EMAIL` | UNSET | SET_EMAIL_SHAPED | SET_EMAIL_SHAPED |

`CLIENT_PORTAL_CLIENT_ACCOUNT_ID` remains SET on the API app and UNSET on
C.O.C. Unchanged mismatch; not used by the Demo-tenant login path that
binds from `portalLoginEmail`.

**Baseline did not drift. Audit continued.**

---

## 2. Demo account conversion state

Read-only. `default_transaction_read_only = on`. Host (masked):
`sa360-po….ondigitalocean.com:25060` database `defaultdb`.

Authorized `GET /admin/v1/clients/:id` for Smart Agent 360 Demo: **200**.
Response includes `hasPortalPassword` / `hasOutstandingPortalInvite` only —
no `portalPasswordHash`, no `portalInviteTokenHash`.

| Field | Production |
| --- | --- |
| `portalEnabled` | **true** |
| `portalLoginEmail` | **present** (value withheld) |
| `portalPasswordHash` | **SET** (`scrypt$…` format; value withheld) |
| `portalPasswordSetAt` | **SET** |
| `portalSessionEpoch` | **1** |
| `portalInviteTokenHash` | **null** |
| `portalInviteExpiresAt` | **null** |
| `hasPortalPassword` | **true** |
| `hasOutstandingPortalInvite` | **false** |
| status | active |

Epoch **1** is the first conversion increment from the pre-conversion
production baseline of **0** (legacy access-code cutover, 2026-09-01).
No evidence of a later production epoch transition.

---

## 3. Other tenants remain unchanged

Eleven `ClientAccount` rows total. Portal-enabled remains three.

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted (`portalPasswordHash` not null) | **1** |
| Shared-env fallback | **2** |
| Outstanding invites | **0** |

| Safe display name | portalEnabled | login email? | hasPortalPassword | portalSessionEpoch | outstanding invite | status |
| --- | --- | --- | --- | --- | --- | --- |
| Smart Agent 360 Demo | true | yes | **true** | **1** | no | active |
| Breanna Kimberling | true | yes | false | 0 | no | onboarding |
| Vet Life — James Torrey | true | yes | false | 0 | no | active |

Converted account identified only as **Smart Agent 360 Demo**.
Breanna Kimberling and Vet Life — James Torrey were not modified by this
audit (hash still null, epoch still 0, invite still null after all
read-only probes).

---

## 4. New Demo password login

The new per-customer password was **not** requested, printed, or logged.

Live contract (`authenticatePortalCustomerLogin`): when
`portalPasswordHash` is bound, the only success path is
`passwordCheck=customer`. `env_fallback` is returned only when the hash
is null.

Supporting live evidence:

- Demo hash is bound (`scrypt`), epoch **1**
- Demo + dummy password → **401** `INVALID` (no `passwordCheck`)
- Demo + shared env password → **401** `INVALID` (see §5)
- Operator signed in on production `/portal/login` with the new
  per-customer password (password never entered into the agent)

A successful login against a bound hash cannot be `env_fallback`.
Authentication source = **customer**.

After sign-in, the live session at
`https://sa360-api-staging-coo57.ondigitalocean.app/portal` showed:

- Header **Smart Agent 360 Demo**, **Sign out** present
- Overview hero **Smart Agent 360 Demo — LO-1049**, spreadsheet ready
- Recent orders **only** Demo: LO-1049, LO-1048, LO-1047, LO-1046, LO-1044
- Account page header **Smart Agent 360 Demo** (no other tenant)

---

## 5. Shared password rejection

Server-side probe against production `POST /client/v1/portal-login` using
the existing protected C.O.C. `CLIENT_PORTAL_LOGIN_PASSWORD` (value never
printed). Demo login email was read in-process and not printed.

| Probe | Result |
| --- | --- |
| Demo + shared env password | **401** `{ ok:false, code:"INVALID" }` |
| Demo row after probe | hash still set, `portalPasswordSetAt` still set, epoch still **1**, invite still null |

This test did not modify the Demo account.

---

## 6. Remaining fallback tenants

The temporary shared-password fallback is still operational for
unconverted portal tenants. Demo conversion did not disable it globally.

| Tenant | Live `POST /client/v1/portal-login` |
| --- | --- |
| Breanna Kimberling | **200** `passwordCheck=env_fallback`, epoch **0**, `hasPortalPassword=false` |
| Vet Life — James Torrey | **200** `passwordCheck=env_fallback`, epoch **0**, `hasPortalPassword=false` |

API `CLIENT_PORTAL_LOGIN_PASSWORD` remains UNSET by design (#109
BFF-verify). C.O.C. desired and running specs still have that key **SET**.
`authenticatePortalLogin` on C.O.C. still calls
`verifyClientPortalPassword` after `env_fallback`. No credential values
were exposed. Neither fallback tenant was converted.

---

## 7. Tenant isolation

Using Demo's portal tenant context (`clientAccountId` bound from the Demo
row; value withheld):

| Check | Result |
| --- | --- |
| Demo `GET /client/v1/lead-orders` | **200**, **5** orders: LO-1049, LO-1048, LO-1047, LO-1046, LO-1044 |
| Display names on that list | **only** Smart Agent 360 Demo |
| Demo order detail LO-1049 | **200** |
| Demo leads for LO-1049 | **200**, 1 fulfilled lead (PII withheld) |
| Demo released exports for LO-1049 | **200**, 1 released download |
| Demo export download | **200** CSV (`content-disposition` attachment) |
| Foreign order LO-1053 as Demo | **404** `Lead order not found` |
| Foreign leads as Demo | **404** `Lead order not found` |
| Foreign exports as Demo | **404** `Lead order not found` |

The two still-unconverted portal tenants have **zero** lead orders
(unchanged). The foreign order used for the 404 probe belongs to a
portal-disabled account and was not modified. No order, lead, export, or
customer row was written.

Live Demo session (same cookie, no writes):

| Surface | Result |
| --- | --- |
| `/portal` | Demo header; five Demo orders only |
| `/portal/orders` | Demo LO-1049…LO-1044 only |
| `/portal/orders/:LO-1049` | Demo detail; released download `Smart-Agent-360-Demo_LO-1049_…csv`; 1 order lead (PII withheld) |
| `/portal/leads` | Demo header; phones masked; no other tenant name |
| `/portal/account` | Demo header |
| `/portal/orders/:LO-1053` (foreign) | **Order not found** — “This order is not available on your account.” Session stayed Demo |

C.O.C. BFF continues to reject browser `clientAccountId` override
(`portalBffHasBrowserTenantOverride`). API isolation used the
server-to-server portal key with Demo's bound tenant id — the same
scoping `getClientLeadOrder` / `listFulfilledLeadsForClientOrder` /
`listClientReleasedDeliveries` apply when the session supplies that id.

---

## 8. Session epoch

Authoritative `GET /client/v1/portal-session-state` for Demo: **200**,
`portalEnabled=true`, `portalSessionEpoch=1`.

`isPortalSessionEpochCurrent(0, 1) === false` — the same helper
`readTrustedPortalSession` uses. A hypothetical pre-conversion epoch-0
session is stale against the current contract. No production legacy
session was minted or reused.

---

## 9. Invite single-use state

The invite used for conversion is consumed:

- `portalInviteTokenHash` = null
- `portalInviteExpiresAt` = null
- `hasOutstandingPortalInvite` = false (DB and admin DTO)

A second invite was **not** issued. Replay behavior remains the already
proven integrated contract
(`docs/validation/portal-auth-integrated-regression-2026-09-01.md` §4):
accept of a consumed/dummy token → **400** `INVITE_INVALID`, no account
id or email leak. Production `acceptPortalInvite()` still clears the
invite columns and increments epoch exactly once.

---

## 10. Legacy bypass

`CLIENT_PORTAL_ACCESS_CODE` is **UNSET** on the desired and running
Admin C.O.C. specs. The former code was not retrieved.

| Probe | Result |
| --- | --- |
| `GET /portal` (no query) | **307** `Location: /portal/login?next=%2Fportal` — no portal session cookie |
| `GET /portal?access=__sa360_invalid_access_probe__` | RSC **200** with `NEXT_REDIRECT;replace;/portal/login` — **no** `sa360_client_portal_session` / `sa360_client_portal_access` cookie |
| Browser open of the same `?access=` URL | Lands on **`/portal/login`** “Sign in to your dashboard” — not the dashboard |

Current master still treats a missing/blank env as invalid
(`getClientPortalAccessCode` → `isValidPortalAccessCode` false). The
path was not restored.

---

## 11. Delivery safety

Unchanged. Nothing was written.

| Control | Production |
| --- | --- |
| NextGen | **capture_only** (`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` SET to that value) |
| LF2 execution | **off** (`SA360_LF2_EXECUTION_ENABLED` absent; safety `lf2ExecutionEnabled: false`) |
| LF2 GHL canary | **off** (`lf2GhlCanaryEnabled: false`, allowlists unset) |
| Delivery runtime | **simulate** (`GET /admin/v1/delivery-runtime-mode` → `effectiveMode=simulate`, `canRunLiveCanary=false`) |
| Effective GHL | **simulate** (runtime). Env `GHL_DELIVERY_ADAPTER_MODE` remains `live_canary`; the runtime row keeps live canary closed. |
| Safety | `GET /admin/v1/fulfillment-ops/safety` → **200**, `simulationOnly: true`, `liveDeliveryEnabled: false`, `liveDeliveryStatus: LIVE DISABLED` |
| Safety message | `Simulation only — no external delivery will occur.` |

---

## 12. Matrix

| Item | Result |
| --- | --- |
| Production SHA | `5c92ece` API = worker = Admin C.O.C. = master |
| Migrations | 73/73, 0 pending, 0 failed |
| Legacy access code | **UNSET** |
| Portal-enabled / converted / fallback / invites | **3 / 1 / 2 / 0** |
| Demo password set | **YES** |
| Demo session epoch | **1** |
| Demo invite consumed | **YES** |
| Demo new password login | **PASS** (customer) |
| Demo shared-password rejection | **PASS** (401 INVALID) |
| Demo portal access | **PASS** |
| Tenant isolation | **PASS** (404) |
| Other tenants unchanged | **YES** |
| NextGen / LF2 / GHL | capture_only / off / simulate |

**A. Did the first production per-customer conversion succeed?**  
**YES.** Demo only. Epoch 0 → 1. Invite consumed. Shared password rejected.

**B. Did conversion break the temporary fallback for everyone else?**  
**NO.** Two portal tenants remain on `env_fallback`.

**C. Is it safe to convert the first real customer?**  
**YES**, one-at-a-time, without re-enabling the access code, and without
issuing a Demo re-invite.

---

## What this task did not do

- No DigitalOcean spec write, env edit, deploy, rollback, or retry
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance or replay invite
- No password reset and no print of the new Demo password
- No change to Breanna Kimberling or Vet Life — James Torrey
- No use of the former production access code
- No email, flag, NextGen, LF2, or GHL change
- No product PR

# SA360 first real customer portal conversion — Vet Life — James Torrey — 2026-09-02

Read-only production verification after the operator converted **only**
Vet Life — James Torrey with the production C.O.C. one-time portal invite
flow. Smart Agent 360 Demo was already converted and verified.

Started from current `origin/master`. No invite was issued. No password was
reset or printed. No portal settings were saved. No customer record was
written by this audit. No environment variable was changed. No deploy was
triggered. No migration was run. No email was sent. Breanna Kimberling was
not converted. Demo was not reset. Secret values (passwords, hashes,
session secrets, API keys, invite tokens, login emails) are never printed
in this file.

**Audit window:** 2026-09-02T21:42Z–21:43Z (UTC)  
**Git baseline:** `origin/master` = `075068f0ce3d259c1b970b9ae035653523b1225d`  
**Method:** DigitalOcean App Platform metadata (`doctl` read only), public
and authorized HTTP reads, Prisma `SELECT` / `COUNT` with
`default_transaction_read_only = on`. James’s password was **not**
requested or retrieved. The audit browser had **no** live James session
(`/portal` → `/portal/login`).

Local `master` is documentation-only commits ahead of / diverged from
`origin/master`. Production code SHA is the `origin/master` tip.

---

## FINAL VERDICT

**GREEN — JAMES PORTAL CONVERSION PROVEN, READY FOR FINAL CUSTOMER**

Vet Life — James Torrey is the second converted portal tenant: per-customer
`scrypt` password bound, `portalSessionEpoch = 1`, invite consumed. The
legacy shared env password is rejected for James and Demo (`401 INVALID`)
and still works as `env_fallback` for Breanna Kimberling only. James’s
account / orders / leads reads stay scoped to **Vet Life — James Torrey**.
Demo orders and other-tenant orders return **404**. Delivery remains
simulate. Convert Breanna one-at-a-time. Do not re-set
`CLIENT_PORTAL_ACCESS_CODE`. Do not reset Demo or James.

---

## Return card

| Item | Result |
| --- | --- |
| Production SHA | `075068f0ce3d259c1b970b9ae035653523b1225d` (API = worker = Admin C.O.C. = master) |
| Migrations | **73** applied / **0** pending / **0** failed |
| Legacy access code | **UNSET** |
| Portal-enabled total | **3** |
| Converted total | **2** (Smart Agent 360 Demo, Vet Life — James Torrey) |
| Fallback total | **1** (Breanna Kimberling) |
| Outstanding invites | **0** |
| James — password set? | **YES** (`hasPortalPassword=true`, `portalPasswordSetAt` set, `scrypt` format) |
| James — invite consumed? | **YES** (hash null, expiry null, `hasOutstandingPortalInvite=false`) |
| James — session epoch | **1** |
| James — customer auth verified? | **YES** (hash-first `customer` path only; see §4) |
| James — shared password rejected? | **YES** (`401 INVALID`) |
| James — tenant isolation verified? | **YES** (Demo + other-tenant orders **404**; leads display-name scoped) |
| Demo unchanged? | **YES** |
| Breanna unchanged? | **YES** |

---

## 1. Baseline

`origin/master` = `075068f0ce3d259c1b970b9ae035653523b1225d`  
`fix(portal): harden login email editing and leads filter navigation (#115)`

| Component | App | Active deploy | Cause | Source SHA | vs origin/master |
| --- | --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` `2c381355-37a1-415f-bf06-ad477add164e` | `45e31c52` **ACTIVE** | commit `075068f` | `075068f` | **MATCH** |
| Worker (`sa360-worker`) | same | same | same | `075068f` | **MATCH** |
| migrate (`sa360-migrate`) | same | same | same | `075068f` | **MATCH** |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` | `37c3a425` **ACTIVE** | commit `075068f` | `075068f` | **MATCH** |

No in-progress deployment. No `ERROR`. Fleet is still **ONE SHA**.

Live `GET /health` and authorized `GET /admin/v1/health` both report
`commitSha=075068f0ce3d259c1b970b9ae035653523b1225d`.

API origin: `https://sa360-sw6oq.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitShort=075068f` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |

`CLIENT_PORTAL_ACCESS_CODE` = **UNSET** on API desired spec, Admin C.O.C.
desired spec, and the running Admin C.O.C. deploy spec (`37c3a425`).
Admin C.O.C. app-level env key count remains **47**.

| Variable | sa360 (API/worker) | admin-coc desired | admin-coc running |
| --- | --- | --- | --- |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** | **UNSET** | **UNSET** |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | UNSET | **SET** | **SET** |

Repository migrations: **73**. Production `_prisma_migrations` (SELECT
only, `default_transaction_read_only = on`):

| Metric | Count |
| --- | --- |
| Applied (`finished_at` set, not rolled back) | **73** |
| Pending vs repository | **0** |
| Failed / unfinished | **0** |

Latest two unchanged since post-#114 PRE_DEPLOY
(`20260831190000_…` / `20260831210000_…`, applied
2026-09-01T18:10:36Z). `prisma migrate deploy` was **not** run from this
workstation.

**Baseline did not drift. Audit continued.**

---

## 2. James conversion state

Read-only. Host (masked): `sa360-postgres-do-user-1494645-….ondigitalocean.com:25060`
database `defaultdb`.

Authorized `GET /admin/v1/clients/:id` for Vet Life — James Torrey:
**200**. Response includes `hasPortalPassword` /
`hasOutstandingPortalInvite` only — no `portalPasswordHash`, no
`portalInviteTokenHash`. Login email present and equal to the DB value
(value withheld).

| Field | Production |
| --- | --- |
| `portalEnabled` | **true** |
| `portalLoginEmail` | **present** (length 29; value withheld) |
| `portalPasswordHash` | **SET** (`scrypt$…` format; value withheld) |
| `portalPasswordSetAt` | **SET** |
| `portalSessionEpoch` | **1** |
| `portalInviteTokenHash` | **null** |
| `portalInviteExpiresAt` | **null** |
| `hasPortalPassword` | **true** |
| `hasOutstandingPortalInvite` | **false** |
| status | active |
| `updatedAt` | **2026-09-02T21:33:00.769Z** |

Epoch **1** is the first conversion increment from the pre-conversion
baseline of **0** (post-#115 smoke, same day). Invite columns are
cleared. No evidence of a later production epoch transition.

---

## 3. Aggregate state

Eleven `ClientAccount` rows total. Portal-enabled remains three.

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted (`portalPasswordHash` not null) | **2** |
| Shared-env fallback | **1** |
| Outstanding invites | **0** |

| Safe display name | portalEnabled | login email? | hasPortalPassword | epoch | invite | status | `updatedAt` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Smart Agent 360 Demo | true | yes | **true** | **1** | no | active | 2026-09-02T12:54:32.770Z |
| Vet Life — James Torrey | true | yes | **true** | **1** | no | active | 2026-09-02T21:33:00.769Z |
| Breanna Kimberling | true | yes | false | 0 | no | onboarding | 2026-06-02T20:08:31.774Z |

Converted accounts identified only as **Smart Agent 360 Demo** and
**Vet Life — James Torrey**. Breanna was not modified (hash still null,
epoch still 0, invite still null, `updatedAt` unchanged). Demo
`updatedAt` unchanged from the Demo conversion audit.

Before/after fingerprints for all 11 rows during this audit: **no
drift**.

---

## 4. James authentication

James’s password was **not** requested, printed, or logged. The audit
browser had no portal session cookie: `GET /portal` → **307**
`/portal/login?next=%2Fportal`. That login tab was closed without
signing in.

Live contract (`authenticatePortalCustomerLogin`): when
`portalPasswordHash` is bound, the only success path is
`passwordCheck=customer`. `env_fallback` is returned only when the hash
is null.

Supporting live evidence:

- James hash is bound (`scrypt`), epoch **1**
- James + dummy password → **401** `INVALID` (no `passwordCheck`)
- James + shared env password → **401** `INVALID` (see §5)
- Authoritative `GET /client/v1/portal-session-state` → **200**,
  `portalEnabled=true`, `portalSessionEpoch=1`

A successful login against a bound hash cannot be `env_fallback`.
Authentication source = **customer**.

Tenant-scoped reads using James’s bound `clientAccountId` (same scoping
`resolveClientPortalTenant` applies to a signed-in session):

| Surface | Result |
| --- | --- |
| `GET /client/v1/account` | **200**, display name **Vet Life — James Torrey** |
| `GET /client/v1/lead-orders` | **200**, **0** orders (James has none) |
| `GET /client/v1/lead-delivery` | **200**, **50** rows, display name **only** Vet Life — James Torrey; `clientAccountId` matches James; **0** overlap with Demo’s 17 leads |

Interactive C.O.C. dashboard click-through was **not** performed (no
password). API identity + hash-first contract stand in for that check.

---

## 5. Shared fallback rejection

Server-side probe against production `POST /client/v1/portal-login` using
the existing protected C.O.C. `CLIENT_PORTAL_LOGIN_PASSWORD` (value never
printed). James login email was read in-process and not printed.

| Probe | Result |
| --- | --- |
| James + shared env password | **401** `{ ok:false, code:"INVALID" }` |
| James row after probe | hash still set, `portalPasswordSetAt` still set, epoch still **1**, invite still null |

This test did not modify the James account.

---

## 6. Breanna fallback

Breanna remains the only unconverted portal tenant.

| Field | Production |
| --- | --- |
| `portalEnabled` | **true** |
| `portalPasswordHash` | **null** |
| `portalSessionEpoch` | **0** |
| outstanding invite | **false** |
| `updatedAt` | **2026-06-02T20:08:31.774Z** (unchanged) |

Live `POST /client/v1/portal-login` for Breanna → **200**
`passwordCheck=env_fallback`, `hasPortalPassword=false`, epoch **0**.

API `CLIENT_PORTAL_LOGIN_PASSWORD` remains UNSET by design (#109
BFF-verify). C.O.C. desired and running specs still have that key **SET**.
Null-hash accounts still take the `env_fallback` branch. Breanna was not
converted.

---

## 7. Tenant isolation

Using James’s portal tenant context (`clientAccountId` bound from the
James row; value withheld):

| Check | Result |
| --- | --- |
| James orders | **200**, **0** (not Demo’s 5) |
| James leads | **200**, display names **only** Vet Life — James Torrey; no Demo lead ids |
| James account | **200**, **Vet Life — James Torrey** |
| Demo order LO-1049 as James (detail / leads / exports) | **404** `Lead order not found` |
| Foreign LO-1053 / LO-1052 / LO-1051 as James | **404** `Lead order not found` |
| Breanna orders | **none** — no Breanna order/lead/export row exists to leak |

Breanna isolation is vacuously safe (zero orders) plus the same
tenant-scoped `getClientLeadOrder` / `listFulfilledLeadsForClientOrder` /
`listClientReleasedDeliveries` that returned 404 for Demo and Lukas
Kaminski orders.

No order, lead, export, or customer row was written.

---

## 8. Demo regression

Smart Agent 360 Demo was **not** reset.

| Field | Production |
| --- | --- |
| `portalEnabled` | **true** |
| login email | **present** (length 23; withheld) |
| `hasPortalPassword` | **true** (`scrypt$`) |
| `portalPasswordSetAt` | **SET** |
| `portalSessionEpoch` | **1** |
| outstanding invite | **false** |
| `updatedAt` | **2026-09-02T12:54:32.770Z** (unchanged this audit) |

| Probe | Result |
| --- | --- |
| Demo + shared env password | **401** `{ ok:false, code:"INVALID" }` |
| Demo orders | **200**, **5**: LO-1049…LO-1044, display name **only** Smart Agent 360 Demo |
| Demo leads | **200**, **17**, display name **only** Smart Agent 360 Demo |

---

## 9. Legacy access

`CLIENT_PORTAL_ACCESS_CODE` is **UNSET** on the API desired spec, Admin
C.O.C. desired spec, and running deploy `37c3a425`. The path was not
restored. `?access=` was not exercised.

---

## 10. Delivery safety

Unchanged. Nothing was written.

| Control | Production |
| --- | --- |
| NextGen | **capture_only** (`SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` SET to that value) |
| LF2 execution | **off** (`SA360_LF2_EXECUTION_ENABLED` absent; safety `lf2ExecutionEnabled: false`) |
| LF2 GHL canary | **off** (`lf2GhlCanaryEnabled: false`, allowlists unset) |
| Delivery runtime | **simulate** (`GET /admin/v1/delivery-runtime-mode` → `effectiveMode=simulate`, `canRunLiveCanary=false`) |
| Effective GHL | **simulate** (runtime) |
| Safety | `GET /admin/v1/fulfillment-ops/safety` → **200**, `simulationOnly: true`, `liveDeliveryEnabled: false`, `liveDeliveryStatus: LIVE DISABLED` |
| Safety message | `Simulation only — no external delivery will occur.` |

---

## 11. Matrix

| Item | Result |
| --- | --- |
| Production SHA | `075068f` API = worker = Admin C.O.C. = master |
| Migrations | 73/73, 0 pending, 0 failed |
| Legacy access code | **UNSET** |
| Portal-enabled / converted / fallback / invites | **3 / 2 / 1 / 0** |
| James password set | **YES** |
| James session epoch | **1** |
| James invite consumed | **YES** |
| James customer auth | **PASS** (hash-first `customer`; no interactive password) |
| James shared-password rejection | **PASS** (401 INVALID) |
| Tenant isolation | **PASS** (404) |
| Demo unchanged | **YES** |
| Breanna unchanged | **YES** |
| NextGen / LF2 / GHL | capture_only / off / simulate |

**A. Did the first real customer per-customer conversion succeed?**  
**YES.** James only (plus the already-converted Demo). Epoch 0 → 1.
Invite consumed. Shared password rejected.

**B. Did conversion break the temporary fallback for Breanna?**  
**NO.** She remains on `env_fallback`.

**C. Is it safe to convert the final portal-enabled customer (Breanna)?**  
**YES**, one-at-a-time, without re-enabling the access code, and without
resetting Demo or James.

---

## What this task did not do

- No DigitalOcean spec write, env edit, deploy, rollback, or retry
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance or replay invite
- No password reset and no print or request of James’s password
- No change to Breanna Kimberling or Smart Agent 360 Demo
- No use of a former production access code
- No email, flag, NextGen, LF2, or GHL change
- No product PR

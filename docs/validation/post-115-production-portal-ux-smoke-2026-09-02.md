# SA360 post-#115 production portal UX smoke — 2026-09-02

Read-only production verification after merge and auto-deploy of PR #115
(portal login-email edit hardening + leads All/Delivered navigation).

Started from current `origin/master`. No invite was issued. No customer was
converted. No portal settings were saved. No environment variable was
changed. No deploy was triggered or retried. No migration was run from this
workstation. No production row was written. Secret values (passwords,
hashes, session secrets, API keys, invite tokens, login emails) are never
printed in this file.

**Audit window:** 2026-09-02T19:53Z–20:04Z (UTC)  
**Git baseline:** `origin/master` = `075068f0ce3d259c1b970b9ae035653523b1225d`  
**Method:** DigitalOcean App Platform metadata (`doctl` read only), public
and authorized admin / portal HTTP reads, Prisma `SELECT` / `COUNT` with
`default_transaction_read_only = on`, live Admin C.O.C. browser (James
Torrey email UX, Cancel only), and live Demo portal session (operator
typed the existing per-customer password; password never entered into the
agent).

Local `master` is documentation-only commits ahead of the pre-#115 tip and
one commit behind `origin/master`. Production code SHA is the
`origin/master` tip (`075068f`).

---

## FINAL VERDICT

**GREEN — #115 LIVE AND CUSTOMER INVITE UX SAFE**

**HOSTNAME COSMETIC ONLY — LIVE PRODUCTION HOST**

Admin C.O.C., API, worker, and migrate are **ACTIVE** on current master
`075068f`. Migrations remain **73/73**. James Torrey default portal-access
view shows the persisted customer identity and **no** saveable
`portalLoginEmail` input. Edit/Cancel works from the saved server value
and was not Saved. Demo remains the only converted tenant; shared
password still rejected. Live Demo `/portal/leads` All ↔ Delivered (three
cycles) plus Back/Forward keep URL, pill, and list tree in sync.

Do **not** re-set `CLIENT_PORTAL_ACCESS_CODE`. Do not reset Demo. Convert
paying tenants one at a time.

---

## Return card

| Item | Result |
| --- | --- |
| Production SHA | `075068f0ce3d259c1b970b9ae035653523b1225d` (API = worker = Admin C.O.C. = master) |
| Migrations | **73** applied / **0** pending / **0** failed |
| Health | `/health` `/health/db` `/health/queue` **200**; authorized `/admin/v1/health` **200** |
| James — saved login identity | **PASS** (present, matches DB + admin DTO; value withheld) |
| James — default view has no email input | **PASS** |
| James — autofill cannot show operator email as a saveable login field | **PASS** |
| James — Edit reveals field from saved server value | **PASS** |
| James — Cancel makes no change | **PASS** (no Save) |
| James — `hasPortalPassword` | **false** |
| James — outstanding invite | **false** |
| Demo — converted / password set / no invite | **YES** / **YES** (`scrypt$`) / **YES** |
| Demo — tenant-safe | **PASS** (foreign order **404**) |
| Demo — legacy shared password | **401** `INVALID` |
| Leads All → Delivered → All (×3) | **PASS** |
| Leads Back / Forward | **PASS** |
| Hostname | **HOSTNAME COSMETIC ONLY — LIVE PRODUCTION HOST** |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** |
| Portal-enabled / converted / fallback / invites | **3 / 1 / 2 / 0** |
| Customer rows changed | **NONE** |

---

## 1. Deployment

`origin/master` = `075068f0ce3d259c1b970b9ae035653523b1225d`  
`fix(portal): harden login email editing and leads filter navigation (#115)`

PR #115 **MERGED** 2026-09-02T19:40:34Z —
https://github.com/BirdofRain/sa360/pull/115

#115 is C.O.C./portal UX only. No auth hashing, session, tenant, fulfillment,
or Prisma migration changes.

Apps (read-only):

- `sa360` `2c381355-37a1-415f-bf06-ad477add164e` — API + worker + migrate
- `sa360-admin-coc` `2075694a-ed30-4e7c-ae59-87b3ebfa9db7` — Admin C.O.C. + portal

`#115` merge triggered auto-deploy on both apps (`cause=commit 075068f
pushed to github.com/BirdofRain/sa360/tree/master`). This audit did not
create, retry, or cancel either deployment.

| Component | App | Active deploy | Phase | Source SHA | vs `origin/master` |
| --- | --- | --- | --- | --- | --- |
| API (`sa360-api`) | `sa360` | `45e31c52` | **ACTIVE** | `075068f0ce3d259c1b970b9ae035653523b1225d` | **MATCH** |
| Worker (`sa360-worker`) | same | same | **ACTIVE** | `075068f` | **MATCH** |
| migrate (`sa360-migrate`, `kind: PRE_DEPLOY`) | same | same | **SUCCESS** | `075068f` | **MATCH** |
| Admin C.O.C. (service `sa360`) | `sa360-admin-coc` | `37c3a425` | **ACTIVE** | `075068f` | **MATCH** |

Timeline (`sa360` `45e31c52` and C.O.C. `37c3a425`):

| Time (UTC) | Event |
| --- | --- |
| 19:40:34 | #115 merged |
| 19:40:37 | both deploys created (`BUILDING`) |
| 19:40:42–19:44:14 | `sa360` build **SUCCESS** |
| 19:44:19–19:46:00 | deploy step; migrate ran `pnpm migrate:deploy` |
| 19:46:01 | `sa360` **ACTIVE** |
| 19:46:10 | Admin C.O.C. **ACTIVE** |

Previous live `sa360` deploy `97744d5e` (`5c92ece`) is **SUPERSEDED**.
Previous live C.O.C. deploy `de741efc` (`5c92ece`, spec update) is
**SUPERSEDED**.

No in-progress deployment. No `ERROR` on the #115 deploys.

**Fleet status: ONE SHA.**

---

## 2. Migrations

`sa360-migrate` remains App Platform `kind: PRE_DEPLOY`, run command
`pnpm migrate:deploy`. Job source SHA = `075068f`.

PRE_DEPLOY run log (read-only, deploy `45e31c52`):

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

Latest two (unchanged since post-#114 PRE_DEPLOY):

- `20260831190000_client_account_portal_password_foundation` — applied
  `2026-09-01T18:10:36.634Z`
- `20260831210000_client_account_portal_invite` — applied
  `2026-09-01T18:10:36.653Z`

`prisma migrate deploy` was **not** run from this workstation. #115 added
no migration.

---

## 3. Health

API origin: `https://sa360-sw6oq.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /health` | **200** | `ok`, `service=api`, `commitSha=075068f0ce3d259c1b970b9ae035653523b1225d` |
| `GET /health/db` | **200** | `db=connected` |
| `GET /health/queue` | **200** | `queue=PONG` |
| `GET /admin/v1/health` (no key) | **401** | auth still required |
| `GET /admin/v1/health` (authorized) | **200** | `service=admin`, `env=production`, same SHA |

Public C.O.C. / portal origin:
`https://sa360-api-staging-coo57.ondigitalocean.app`

| Endpoint | HTTP | Notes |
| --- | --- | --- |
| `GET /portal/login` | **200** | HTML sign-in |
| `GET /portal/leads` (no session) | **307** | `Location: /portal/login?next=%2Fportal%2Fleads` |

---

## 4. Portal email safety — Vet Life — James Torrey

Live Admin C.O.C. `/clients/vet_life_james_torrey` on SHA `075068f`.
**Save portal settings was never clicked. Generate portal invite was never
clicked.**

Authorized `GET /admin/v1/clients/:id` **200**: `portalEnabled=true`,
`hasPortalPassword=false`, `hasOutstandingPortalInvite=false`, login email
present and **equal to the DB value**. Admin DTO does not leak
`portalPasswordHash`.

### Default view

| Check | Result |
| --- | --- |
| Saved identity summary | Present (`data-testid=portal-login-email-identity`, length **29**, matches DB) |
| `input#portalLoginEmail` / `input[name=portalLoginEmail]` / `input[type=email]` | **absent** |
| Portal-access inputs | `portalEnabled` checkbox + `portalDisplayName` (`autocomplete=off`) only |
| Edit control | **Edit login email** button present |
| Password status | **Not set** |
| Displayed Portal login URL | `https://sa360-api-staging-coo57.ondigitalocean.app/portal/login` |

Password-manager autofill cannot display an operator email as a saveable
portal login field: there is no email/`portalLoginEmail` input in the
default DOM.

### Edit / Cancel (no Save)

**Edit login email** reveals a Current / New panel:

- Current portal login email = same saved identity (text, not an input)
- New portal login email input present
- Initial `value` length **29** and **equals** the identity text
- `type=text` (not `email`), `inputMode=email`, `autocomplete=off`,
  `data-1p-ignore`, `data-lpignore`, `data-bwignore`, `data-form-type=other`

**Cancel** restored the default view: email input gone, identity still
length 29, Edit button back, no Cancel button.

James fingerprint after Cancel (and after the rest of this audit):

| Field | Production |
| --- | --- |
| `portalEnabled` | **true** |
| login email | **present** (length 29; value withheld) |
| `hasPortalPassword` | **false** |
| `portalSessionEpoch` | **0** |
| outstanding invite | **false** |
| status | active |
| `updatedAt` | **2026-06-17T21:07:47.666Z** (unchanged) |

---

## 5. Demo regression

Smart Agent 360 Demo was **not** reset.

| Field | Production |
| --- | --- |
| `portalEnabled` | **true** |
| login email | **present** (length 23; value withheld) |
| `portalPasswordHash` | **SET** (`scrypt$` prefix; value withheld) |
| `portalPasswordSetAt` | **SET** |
| `portalSessionEpoch` | **1** |
| outstanding invite | **false** |
| `hasPortalPassword` (admin DTO) | **true** |
| `updatedAt` | **2026-09-02T12:54:32.770Z** (unchanged this audit) |

| Probe | Result |
| --- | --- |
| `GET /client/v1/portal-session-state` | **200**, `portalEnabled=true`, epoch **1** |
| Demo + dummy password | **401** `{ ok:false, code:"INVALID" }` |
| Demo + shared env password | **401** `{ ok:false, code:"INVALID" }` |
| Demo `GET /client/v1/lead-orders` | **200**, **5** orders, display name **only** Smart Agent 360 Demo |
| Foreign order as Demo | **404** `Lead order not found` |

Live Demo session header: **Smart Agent 360 Demo**, Sign out present.
`/portal/leads` showed Demo-only names and masked phones. No other tenant
name.

---

## 6. Leads filter — live Demo portal

Start: `/portal/leads` after operator Demo login (`next=/portal/leads`).

Authoritative API (same tenant, read-only):

| Query | HTTP | Count | Shape |
| --- | --- | --- | --- |
| All (`/client/v1/lead-delivery`) | **200** | **17** | presented statuses: 15 `not_started`, 1 `delivered`, 1 `skipped` |
| Delivered (`?status=delivered`) | **200** | **0** | empty list |

`status=delivered` filters `SourceLeadEvent.status`, not the presented
delivery label. The live UI therefore shows the **list tree** on All and
the **delivered empty-state tree** on Delivered. That contrast is what
#115 had to keep in sync when clearing the query.

### Click cycles (three)

Each Delivered click:

- URL = `/portal/leads?status=delivered`
- Delivered `aria-current=page`; All inactive
- Tree: heading **Delivered leads**, copy **“No delivered leads match this
  filter.”** + **“Choose All to see every lead we can show.”**
- `View lead` count = **0**; All-list names absent

Each All click:

- URL = `/portal/leads` (no query)
- All `aria-current=page`; Delivered inactive
- Tree: All-state list (Tracey Miller and the rest of the 17 Demo leads;
  phones masked)
- Delivered empty copy **absent**

Repeated **three** times. Same result every time.

### Back / Forward

From All after cycle 3:

| Action | URL | Active pill | Tree |
| --- | --- | --- | --- |
| Back | `/portal/leads?status=delivered` | Delivered | delivered empty-state |
| Forward | `/portal/leads` | All | All list (17 leads) |
| Back again | `/portal/leads?status=delivered` | Delivered | delivered empty-state |

Filter state is URL-driven. Internal source statuses are not exposed as
pills (only All / Delivered).

---

## 7. Portal URL / hostname investigation

Production C.O.C. previously displayed a portal login URL resembling
`sa360-api-staging-….ondigitalocean.app/portal/login`.

### Live hosts (no custom domains)

| Surface | App | Live URL |
| --- | --- | --- |
| Admin C.O.C. + `/portal` | `sa360-admin-coc` | `https://sa360-api-staging-coo57.ondigitalocean.app` |
| API | `sa360` | `https://sa360-sw6oq.ondigitalocean.app` |

`doctl apps get` for C.O.C.: `live_url` = `default_ingress` =
`https://sa360-api-staging-coo57.ondigitalocean.app`. `spec.domains` =
**[]**. That hostname **is** the production Admin C.O.C. / portal host.
The word `staging` is historical App Platform naming, not a second app.

### How the displayed Portal login URL is built

`ClientPortalAccessSection.portalLoginUrl()`:

1. In the browser: `` `${window.location.origin}/portal/login` ``
2. SSR fallback only: `NEXT_PUBLIC_CLIENT_PORTAL_BASE_URL` then
   `NEXT_PUBLIC_SA360_ADMIN_BASE_URL`

On the live James Torrey page the `<code>` value was exactly
`https://sa360-api-staging-coo57.ondigitalocean.app/portal/login`.
That is `window.location.origin` of the production C.O.C. tab.

### Env presence / source (values never printed except hostnames)

| Variable | sa360 (API) | admin-coc desired | admin-coc running `37c3a425` |
| --- | --- | --- | --- |
| `ADMIN_COC_BASE_URL` | **SET_HTTPS** host `sa360-api-staging-coo57.ondigitalocean.app` | **UNSET** | **UNSET** |
| `SA360_PORTAL_PUBLIC_BASE_URL` | **UNSET** | **UNSET** | **UNSET** |
| `NEXT_PUBLIC_CLIENT_PORTAL_BASE_URL` | **UNSET** | **UNSET** | **UNSET** |
| `NEXT_PUBLIC_SA360_ADMIN_BASE_URL` | **UNSET** | **UNSET** | **UNSET** |

`NEXT_PUBLIC_*` are not the source of the URL operators see in C.O.C.
The browser origin is.

### Invite URL base (not exercised)

`buildAbsoluteOrRelativePortalUrl()` /
`resolvePortalPublicBaseUrl()`: `SA360_PORTAL_PUBLIC_BASE_URL` then
`ADMIN_COC_BASE_URL` on the **API**. With the former UNSET, a generated
invite would be an absolute URL on
`https://sa360-api-staging-coo57.ondigitalocean.app` — the live
production C.O.C. host. No invite was issued to prove that.

### Verdict

**HOSTNAME COSMETIC ONLY — LIVE PRODUCTION HOST**

Production is not pointed at a separate staging hostname. The unfortunate
`staging` token is the live production Admin C.O.C. / portal App Platform
default ingress. Invite links, if generated, would use that same host via
API `ADMIN_COC_BASE_URL`. Safe to send a customer invite from a URL
hygiene standpoint. Do **not** change these env vars as part of first
customer conversion.

---

## 8. Auth safety

Presence only. Values not printed. `?access=` not opened.

| Variable | sa360 (API/worker) | admin-coc desired | admin-coc running |
| --- | --- | --- | --- |
| `CLIENT_PORTAL_ACCESS_CODE` | **UNSET** | **UNSET** | **UNSET** |
| `CLIENT_PORTAL_LOGIN_PASSWORD` | UNSET | **SET** | **SET** |
| `CLIENT_PORTAL_SESSION_SECRET` | UNSET | **SET** | **SET** |
| `CLIENT_PORTAL_API_KEY` | **SET** | **SET** | **SET** |
| `CLIENT_PORTAL_LOGIN_EMAIL` | UNSET | SET_EMAIL_SHAPED | SET_EMAIL_SHAPED |

Admin C.O.C. app-level env key count remains **47**.

Read-only `ClientAccount` counts (11 rows total):

| Metric | Count |
| --- | --- |
| Portal-enabled | **3** |
| Converted (`portalPasswordHash` not null) | **1** |
| Shared-env fallback | **2** |
| Outstanding invites | **0** |

| Safe display name | portalEnabled | login email? | hasPortalPassword | epoch | invite | status | `updatedAt` |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Smart Agent 360 Demo | true | yes | **true** | **1** | no | active | 2026-09-02T12:54:32.770Z |
| Breanna Kimberling | true | yes | false | 0 | no | onboarding | 2026-06-02T20:08:31.774Z |
| Vet Life — James Torrey | true | yes | false | 0 | no | active | 2026-06-17T21:07:47.666Z |

Before/after fingerprints for all 11 `ClientAccount` rows: **no
`updatedAt` / hash / invite / email-length drift**. No customer rows
changed.

---

## 9. Matrix

| Item | Result |
| --- | --- |
| Admin C.O.C. SHA | `075068f` **MATCH** master |
| API SHA | `075068f` **MATCH** master |
| Worker SHA | `075068f` **MATCH** master |
| Migrations | **73/73** (PRE_DEPLOY no-op) |
| Health | **200** |
| James email UX | **PASS** (no Save) |
| Demo conversion | **unchanged / PASS** |
| Leads filter + history | **PASS** |
| Hostname | **COSMETIC ONLY — LIVE PRODUCTION HOST** |
| Access code | **UNSET** |
| 3 / 1 / 2 / 0 | **YES** |
| Customer writes | **NONE** |

**A. Is #115 live on one SHA?**  
**YES.**

**B. Is the James login-email autofill defect gone in production?**  
**YES.** Default view has no saveable email field.

**C. Does All return from Delivered on the live Demo portal?**  
**YES**, including Back/Forward.

**D. Is the `staging` portal URL a misconfiguration?**  
**NO.** It is the live production C.O.C. hostname.

**E. Resume first real customer conversion?**  
**YES**, one-at-a-time, without re-enabling the access code, and without
resetting Demo.

---

## What this audit did not do

- No DigitalOcean spec write, env edit, deploy, rollback, or retry
- No `prisma migrate deploy` / `db push` / Studio from this workstation
- No portal invite issuance
- No password reset and no print of the Demo password
- No Save on James Torrey portal settings
- No change to Breanna Kimberling or Vet Life — James Torrey
- No use of a former access code
- No email, flag, NextGen, LF2, or GHL change
- No product PR

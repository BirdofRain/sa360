# Google account + Google Sheets delivery — current-state audit and Phase 1 design

Status: **proposed** (audit / design only). No product code, migration, Google Cloud
configuration, OAuth credentials, or production environment variables were changed
for this document.

Audited against `origin/master` at `3f62b01` (Meta Lead Ads Phase 1C flag-off
checkpoint). Direct Meta Lead Ads work is paused at that checkpoint; this design
is the next workstream.

Product objective: a customer connects their Google account in the portal and uses
a Google Sheet as a lead-delivery destination, without inventing a parallel
fulfillment architecture.

Canonical flow (required):

```text
canonical lead
  → fulfillment / delivery plan
  → destination adapter (google_sheets.v1)
  → Google Sheets write
  → DeliveryAttempt / instruction / allocation status
```

Forbidden flow:

```text
lead intake → special Google path
```

Inbound Google Sheet **intake** (`POST /sources/google-sheet/lead-created`) already
exists and must stay a source adapter. It is not the delivery destination.

---

## A. Current repo findings

SA360 does **not** write to Google Sheets today. There is no `googleapis` /
`google-auth-library` dependency, no Google OAuth client, no stored Google tokens,
and no Sheets or Drive API caller in `apps/api`, `apps/worker`, `apps/admin-coc`,
or `packages/shared`.

What exists instead:

| Surface | What it actually is |
| --- | --- |
| Inbound `google_sheets` source | Apps Script → webhook JSON into SA360. Shadow/dry-run routing only. |
| LF2 `google_sheets.v1` | Planning-registry stub. Validates `configMetadata.sheetId`. No `deliver` / `deliverLive`. |
| Legacy `write_backup_sheet` | GHL delivery-plan step. Preview only. Live canary **blocked** (“not enabled in Phase 4I”). |
| `backupSheetEnabled` / `backupSheetId` | Config strings on `ClientGhlDestination` and `CampaignRoutingRule`. Not OAuth. |
| `backup_sheet_export.mode` | Runtime setting / env `BACKUP_SHEET_EXPORT_MODE`. Seeded, **never consumed by an exporter**. |
| Buyer “spreadsheet” | CSV package (`LeadDeliveryExportPackage`) + operator phrase `MARK SPREADSHEET DELIVERED`. Portal “Download spreadsheet” = `text/csv`. |
| LF2 `file_export.csv.v1` | Simulation-only CSV fingerprint. Explicit `sheetsApiWrite: false`. |
| `webhook.generic.v1` | Planning stub (needs `endpointUrl`). No execution adapter. Same seam as Sheets. |
| Bulk import `google_sheet` | Type/docs placeholder. Admin `.../google-sheets/preview\|commit` **not implemented**. |

Tenant model: **`ClientAccount` is the customer/tenant**. There is no
`CustomerAccount`, `IntegrationConnection`, or token vault. The only complete OAuth
implementation is **GHL**, on a dedicated encrypted connection table.

Live LF2 writes exist only for `ghl.crm.v1`, and only as a **manual admin canary**
behind deny-by-default flags. The worker (`fulfillment-shadow`) plans allocations
and instructions; it does **not** execute live adapters.

---

## B. Existing Google / Sheets code

### B.1 Inbound source (keep; do not reuse as delivery)

| Path | Role |
| --- | --- |
| `apps/api/src/routes/sources-google-sheet.ts` | `POST /sources/google-sheet/lead-created`, `x-sa360-secret` |
| `apps/api/src/schemas/google-sheet-lead.schema.ts` | Apps Script envelope (`source_sheet_id`, contact, attribution) |
| `apps/api/src/services/source-intake/google-sheet-lead-intake.service.ts` | Shadow/dry-run only; suppresses live delivery |
| `apps/api/src/services/source-intake/google-sheet-lead-normalizer.ts` | Provider `google_sheets`, system `google_sheet_import` |
| Prisma enums | `WebhookRequestSource.google_sheets`, `SourceLeadProvider.google_sheets`, `SourceLeadSystem.google_sheet_import` |

This is **lead in**. Delivery must not branch here.

### B.2 Outbound placeholders (do not treat as implemented)

| Path | Role |
| --- | --- |
| `apps/api/src/services/fulfillment-shadow/delivery-adapter.registry.ts` | `google_sheets.v1` validate-only stub (`sheetId`) |
| `apps/api/src/services/lead-delivery-plan.service.ts` | Step `write_backup_sheet`, `targetSystem: "google_sheets"` |
| `apps/api/src/services/ghl-delivery-adapter/ghl-delivery-request-builders.ts` | `buildBackupSheetPreview` (`method: "APPEND"`) |
| `apps/api/src/services/ghl-delivery-adapter/ghl-live-canary-executor.service.ts` | Live step **blocked** |
| `apps/api/src/lib/admin-runtime-settings-keys.ts` | `backup_sheet_export.mode` (`disabled` default, empty `liveValues`) |
| Admin delivery-readiness drawer | “Backup sheet enabled” / id fields |

`google_sheets.v1` is referenced **only** in the planning registry. No seed,
`DeliveryTarget` factory, or test creates a live Sheets target. Evolving the stub
metadata shape (`sheetId` → `spreadsheetId` + worksheet + connection ref) is safe.

### B.3 Buyer CSV / manual spreadsheet (keep as FREE download path)

| Path | Role |
| --- | --- |
| `apps/api/src/services/ppl-fulfillment/buyer-csv-export.service.ts` | Preview/commit/download; `markSpreadsheetDelivered` |
| `apps/api/src/services/fulfillment-execution/file-export-csv-execution.adapter.ts` | LF2 sim CSV; `sheetsApiWrite: false` |
| `LeadDeliveryExportPackage` | Immutable CSV bytes + `spreadsheetDeliveredAt` attestation |
| Portal “Download spreadsheet” | CSV download BFF |

Do **not** replace this with Sheets in Phase 1. FREE positioning is portal access
**and** CSV download **and** Sheets push. They are complementary.

### B.4 Reuse vs freeze vs do not build on

**Reuse**

- LF2 `DeliveryTarget` / `DeliveryInstruction` / `DeliveryAttempt` / outbox
- Planning key `google_sheets.v1` (extend validation; add execution adapter)
- GHL OAuth patterns: AES-256-GCM tokens, HMAC state, presenters, disconnect wipe
- Buyer-safe field allowlists for row contents
- Deny-by-default LF2 canary flags as the rollout template
- Portal `/portal/account` as the additive integrations attach point
- Admin client delivery-config + fulfillment-ops as operator attach points

**Freeze (do not extend into the customer Sheets product)**

- `ClientGhlDestination.backupSheet*` and routing-rule copies
- Legacy `write_backup_sheet` GHL plan step
- `backup_sheet_export.mode` (flag without an exporter)
- Inbound Google Sheet webhook

**Do not copy**

- `ClientConfig.metaAccessToken` plaintext
- Tokens inside `DeliveryTarget.configMetadataJson` (rejected by
  `validateDeliveryTargetMetadata`)
- A second outbox, queue, or attempt ledger
- A special intake-to-Sheets path

---

## C. Exact integration seam

LF2 is already channel-neutral. GHL is documented as **one adapter**
(`docs/adr/lf2-fulfillment-shadow-core.md`). Sheets is the next adapter.

```text
SourceLeadEvent
  → FulfillmentOutbox (workType shadow_fulfillment_v1 today)
  → worker fulfillment-shadow
  → eligibility + LeadAllocation
  → planDeliveryInstructionsForAllocation()
       lists enabled DeliveryTarget rows for the ClientAccount
       validates adapterKey via planning registry
  → DeliveryInstruction (unique per allocation + target)
  → [manual today] reserve → claim DeliveryAttempt
  → ExecutionAdapterContract.deliverLive()
  → outcome service (succeeded | retryable | terminal_pre_send | unknown_outcome)
```

**Plug-in point:** implement
`apps/api/src/services/fulfillment-execution/google-sheets-execution.adapter.ts`
with `adapterKey: "google_sheets.v1"` and register it in
`execution-adapter.registry.ts` beside `ghl.crm.v1` and `file_export.csv.v1`.

Planning already lists the key. Execution does not. Claim/live today fails with
`adapter_not_registered`.

Supporting seams to reuse, not fork:

| Concern | Existing source of truth |
| --- | --- |
| Destination config (non-secret) | `DeliveryTarget.configMetadataJson` |
| Credentials | New connection table (GHL analog), **not** metadata |
| Plan | `DeliveryInstruction` |
| Attempt / idempotency / audit | `DeliveryAttempt.idempotencyKey` unique |
| Durability | `FulfillmentOutbox` |
| Worker HTTP boundary | `POST /admin/v1/fulfillment-shadow/internal/process-outbox` |
| Secret metadata rejection | `apps/api/src/lib/delivery-target-metadata.validation.ts` |

`LeadOrder.deliveryDestinationType` is a free-text commercial label (`ghl`,
`manual_csv`, `simulation`, ≤120 chars). It is **not** the adapter key. Phase 1
may set customer-safe `google_sheets` on new orders; routing/execution must key
off `DeliveryTarget.adapterKey`.

`ExecutionAdapterDeliverLiveInput` is GHL-shaped (`authoritativeLocationId`,
`contactIdGhl` on results). The Sheets adapter ignores CRM fields. A later small
generalization (location optional) is allowed; do not invent a second execution
contract.

---

## D. Recommended Phase 1 customer journey

Optimize for fastest **safe** MVP: Approach **A** (customer-owned existing sheet)
plus a one-click **create spreadsheet** (Approach B, create-once). No Drive file
listing. No Google Picker. No ongoing “SA360 manages the sheet” repair loop.

```text
Portal /account
  → Connect Google (OAuth consent, least privilege)
  → connection stored on the ClientAccount
  → paste spreadsheet URL/ID  OR  “Create SA360 spreadsheet”
  → confirm worksheet/tab (default first tab / “Leads”)
  → Test connection (read spreadsheet title + header row; no lead write)
  → Save as DeliveryTarget google_sheets.v1 (disabled until flags + operator enable)
  → Operator enables target for allowlisted client
  → LF2 plan includes the Sheets instruction
  → Guarded live write (canary, then gated auto)
  → DeliveryAttempt records success/failure
  → Portal leads/orders show existing delivery status vocabulary
```

Phase 1 does **not**:

- Redesign the portal
- Replace CSV download
- Auto-deliver every lead the moment OAuth succeeds
- Write from intake
- Enable GHL `write_backup_sheet`
- Require Drive.readonly listing of all spreadsheets

---

## E. Data-model changes

Auth/Account lane owns Prisma. Additive only. No migration in this audit PR.

### E.1 New: `GoogleAccountConnection` (credentials)

Mirror `GhlLocationConnection`. Do **not** put tokens on `ClientAccount`,
`ClientGhlDestination`, or `DeliveryTarget`.

Suggested columns:

| Column | Purpose |
| --- | --- |
| `id` | CUID |
| `clientAccountId` | Required. Tenant owner. Index. |
| `googleUserId` | Stable `sub` from userinfo/openid |
| `googleEmail` | Display only |
| `accessTokenEncrypted` | AES-256-GCM |
| `refreshTokenEncrypted` | AES-256-GCM |
| `tokenExpiresAt` | Access-token expiry |
| `scopesJson` | Granted scopes |
| `connectionStatus` | `connected \| reconnect_required \| revoked \| error` |
| `lastError` | Safe summary (no tokens) |
| `lastRefreshAt` | Observability |
| `lastSuccessfulDeliveryAt` | Operator/customer status |
| `tokenVersion` | Compare-and-set refresh |
| `createdAt` / `updatedAt` | Audit |

Phase 1 constraint: **at most one non-revoked connection per `clientAccountId`**.
Reconnect overwrites tokens on the same row and keeps spreadsheet config.

### E.2 New: `GoogleOAuthPendingAuth` (CSRF / PKCE)

Unlike GHL’s mostly-stateless HMAC `state`, Google start happens in the **portal
session**, so persist a one-time row:

| Column | Purpose |
| --- | --- |
| `id` | CUID |
| `clientAccountId` | From portal session only |
| `stateNonce` | Unique, in signed `state` |
| `codeVerifierEncrypted` | PKCE verifier |
| `returnTo` | Allowlisted portal path |
| `expiresAt` | ~10–15 minutes |
| `consumedAt` | Single use |

### E.3 Existing: `DeliveryTarget` (destination config)

No new destination table. One enabled `google_sheets.v1` target per client in
Phase 1 (multiple later if needed).

`configMetadataJson` (non-secret; `googleConnectionId` is a **ref**, and the
validator allows `*RefId` / `*_ref` suffixes — use `googleConnectionId` or
`connectionRefId`, never keys matching `token|secret|oauth|credential`):

```json
{
  "connectionRefId": "clxxxxxxxx",
  "spreadsheetId": "1abc...",
  "spreadsheetName": "SA360 Leads",
  "worksheetId": 0,
  "worksheetTitle": "Leads",
  "headerSchemaVersion": "sheets_delivery_v1",
  "createdBySa360": false
}
```

Evolve planning validation from `sheetId` to `spreadsheetId` (+ optional
worksheet). No production rows use the stub.

### E.4 Do not add

- Token columns on `ClientAccount`
- A generic `IntegrationConnection` (GHL is not generic; YAGNI)
- Sheet-write rows outside `DeliveryAttempt`
- Reuse of `backupSheetId` as the customer destination

Optional later: `lastSuccessfulDeliveryAt` can be derived from `DeliveryAttempt`
instead of stored on the connection. Storing a denormalized timestamp is fine for
admin/portal status if updated only on confirmed success.

---

## F. OAuth architecture

Structural analog: GHL (`apps/api/src/lib/ghl-oauth*.ts`,
`apps/api/src/routes/integrations-ghl.ts`,
`apps/api/src/services/ghl-oauth/*`).

**Do not reuse** `GET /integrations/oauth/callback`. That path is GHL (generic
name, GHL implementation, Admin C.O.C. proxy in `ghl-oauth-callback-proxy.ts`).

### F.1 Routes

| Route | Auth | Role |
| --- | --- | --- |
| `GET /client/v1/integrations/google` | Portal API key + **session tenant** | Status (no tokens) |
| `GET /client/v1/integrations/google/oauth/start` | Same | Create pending auth, redirect to Google |
| `POST /client/v1/integrations/google/disconnect` | Same | Revoke + wipe ciphertext |
| `GET /integrations/google/oauth/callback` | Public | Exchange code, bind tenant from pending row, redirect to portal |
| `POST /client/v1/integrations/google/spreadsheet/resolve` | Portal | Parse URL/ID, `spreadsheets.get`, list tabs |
| `POST /client/v1/integrations/google/spreadsheet/create` | Portal | `spreadsheets.create` + header row |
| `POST /client/v1/integrations/google/test` | Portal | Title + header check; no lead append |
| `PUT /client/v1/delivery-targets/google-sheets` | Portal | Upsert `DeliveryTarget` metadata |
| Admin list/probe/disconnect/enable | Admin API | Operator view + canary enable |

Portal BFF/server actions must pass `clientAccountId` from the **portal session**,
never from a customer-editable query string as the source of truth.

Start-flow `returnTo` allowlist: `/portal/account` and `/portal/account?google_oauth=*`.
Reject absolute external URLs (GHL `returnTo` is operator-controlled; portal
`returnTo` must be stricter).

### F.2 Token storage / refresh / revoke

- Encrypt with the existing AES-256-GCM format (`iv.tag.ciphertext` base64url)
  in `ghl-token-encryption.ts`. Extract generic helpers (same algorithm) rather
  than a second crypto scheme.
- New env key `GOOGLE_TOKEN_ENCRYPTION_KEY` (required). Do **not** silently
  fall back to `GHL_TOKEN_ENCRYPTION_KEY` in production (blast-radius isolation).
  Tests may share a fixture key.
- Refresh ~5 minutes before expiry (same buffer as GHL).
- Google refresh tokens can be rotated; persist the new refresh token every time.
- **Refresh concurrency:** GHL has no lock. Google needs compare-and-set on
  `tokenVersion` / `updatedAt` (or a per-connection advisory lock). Concurrent
  refresh can invalidate the refresh token.
- Disconnect: Google `https://oauth2.googleapis.com/revoke`, then wipe ciphertext
  (encrypt empty or overwrite with random then store empty — match GHL wipe),
  status `revoked`, disable the Sheets `DeliveryTarget`.
- Reconnect: `prompt=consent`, `access_type=offline`, PKCE; overwrite tokens;
  set status `connected`; re-test spreadsheet access; if 403, keep destination
  but mark `reconnect_required` until test passes.

### F.3 State / CSRF / tenant binding

1. Portal session resolves `clientAccountId`.
2. Insert `GoogleOAuthPendingAuth` with PKCE verifier.
3. Signed `state` = HMAC-SHA256(base64url JSON `{ clientAccountId, nonce, exp }`)
   using `GOOGLE_TOKEN_ENCRYPTION_KEY` (no Admin API key fallback).
4. Callback: verify signature, TTL, pending row, matching tenant, unconsumed;
   mark consumed **before** token persist (same transaction if possible).
5. Reject callback if `clientAccountId` in state ≠ pending row.

### F.4 Expiry / reconnect_required

| Condition | Status | Customer CTA |
| --- | --- | --- |
| Access token expired, refresh succeeds | `connected` | none |
| Refresh invalid_grant / revoked | `reconnect_required` | Reconnect |
| Spreadsheet 403/404 | destination not ready; connection may still be `connected` | Fix sharing or pick another sheet |
| User disconnect | `revoked` | Connect |

---

## G. Google scopes (least privilege)

Phase 1 (paste URL/ID + optional create):

| Scope | Why |
| --- | --- |
| `https://www.googleapis.com/auth/spreadsheets` | Read spreadsheet, write rows, create spreadsheet, write header |
| `openid` `email` `profile` | Show which Google account is connected (`sub` + email) |

**Do not request in Phase 1:**

| Scope | Why skip |
| --- | --- |
| `drive` / `drive.readonly` / `drive.metadata.readonly` | Lists the customer’s Drive. Unnecessary if they paste a URL/ID. Sensitive/restricted verification burden. |
| `drive.file` | Needed for Google Picker / files-created-by-app-only model. Defer with Picker. |
| Gmail, Calendar, Contacts | Out of scope |

`spreadsheets` is a **sensitive** scope (not restricted like full Drive). Testing
mode + test users is enough for Sam + one customer. Broad production requires
Google OAuth verification (and possibly CASA). Do not plan a full Drive listing
UX until that cost is accepted.

Create-spreadsheet uses Sheets API `spreadsheets.create` under `spreadsheets`.
No Drive scope required for create-once.

---

## H. Google Cloud setup required (outside the repo)

**Do not create these resources in this task.** Implementation PRs assume a human
configures them.

1. **GCP project** dedicated to SA360 Google integration (not a personal project).
2. **OAuth consent screen:** External, User type External, app name SA360, support
   email, authorized domain of the API/portal hosts.
3. **Publishing status:** Testing for Phase 1 canary. Add test users (Sam, then
   one customer Google account). Testing-mode refresh tokens expire after **7 days**
   — operators must expect reconnect during canary unless the app is published.
4. **APIs to enable:** Google Sheets API. Drive API **not** required for Phase 1.
   Google People / userinfo is covered by oauth2 userinfo endpoints.
5. **OAuth client:** Web application.
6. **Redirect URIs (exact match):**
   - Production API: `https://<api-host>/integrations/google/oauth/callback`
   - Staging API: staging equivalent
   - Local: `http://127.0.0.1:<api-port>/integrations/google/oauth/callback`
7. **Authorized JavaScript origins:** not required until Picker.
8. **Client id/secret:** env only, never DB, never `NEXT_PUBLIC_*`.
9. **Verification:** not required for testing-mode canary. Required before wider
   availability with `spreadsheets` (sensitive). Full Drive would be worse; avoid.

Env vars (names only; no values in repo):

```text
GOOGLE_OAUTH_CLIENT_ID
GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_OAUTH_REDIRECT_URI
GOOGLE_TOKEN_ENCRYPTION_KEY
SA360_GOOGLE_OAUTH_ENABLED
SA360_LF2_SHEETS_CANARY_ENABLED
SA360_LF2_SHEETS_ALLOWED_CLIENT_IDS
SA360_LF2_SHEETS_ALLOWED_ORDER_IDS
```

Redirect URI is the **API** public origin (same lesson as GHL
`GHL_OAUTH_REDIRECT_URI`), not the Admin C.O.C. host. Portal origin is only the
post-OAuth `returnTo`.

---

## I. Sheets destination design

### I.1 Configuration

A destination is an LF2 `DeliveryTarget`, not a parallel “Google destination”
model.

Required:

- `connectionRefId` belonging to the **same** `clientAccountId`
- `spreadsheetId`
- worksheet identity (`worksheetId` gid and/or `worksheetTitle`)
- `headerSchemaVersion`
- `enabled` / `isRequired` / `isPrimary` as LF2 already models

Phase 1: one Sheets target, `isRequired: true` when it is the customer’s FREE
delivery method. GHL remains a separate target for PRO clients; a client may have
both later. Do not silently dual-write in Phase 1 unless the operator enables two
required targets.

### I.2 Spreadsheet selection UX (simplest robust)

**Phase 1:** paste spreadsheet URL or ID, then confirm tab.

Parse accepted forms:

- `https://docs.google.com/spreadsheets/d/{id}/edit#gid={n}`
- `https://docs.google.com/spreadsheets/d/{id}/edit?gid={n}`
- raw spreadsheet id

Then `spreadsheets.get` with the customer token. If 200, show title + tab list
from the API response (tabs for **that file only**, not Drive listing). User
picks a tab or accepts default.

**Create:** button creates a spreadsheet titled like `SA360 Leads — {portalDisplayName}`,
one tab `Leads`, writes the v1 header row, stores `createdBySa360: true`.

**Defer:** Drive file list, Google Picker, folder picker, multi-sheet routing
per order.

### I.3 Header / schema

Store `headerSchemaVersion` on the target. On test-connection and before first
live write, read row 1. If empty, write canonical headers. If present and
compatible (all required columns exist, order may differ), map by header name.
If incompatible, fail closed (`malformed_sheet`, review-required) — do not
invent columns in the middle of a customer sheet.

Created-by-SA360 sheets always get the canonical header in order.

---

## J. Delivery / idempotency design

### J.1 Canonical row schema (`sheets_delivery_v1`)

Buyer-safe, aligned with CSV v4 customer labels, plus delivery audit columns.
Do **not** emit GHL ids, OAuth, pricing, internal cuids beyond stable customer-facing
ids, enrichment blobs, or rehearsal fields.

| Column key | Header label | Source |
| --- | --- | --- |
| `sa360_lead_id` | SA360 Lead ID | `SourceLeadEvent.sourceLeadUid` (or allocation id if uid missing) |
| `sa360_instruction_id` | Delivery ID | `DeliveryInstruction.id` (idempotency lookup) |
| `delivered_at` | Delivered At | Attempt success time (ISO-8601 UTC) |
| `generated_at` | Date Generated | Same as buyer CSV `lead_date` |
| `first_name` | First Name | Normalized contact |
| `last_name` | Last Name | Normalized contact |
| `phone` | Phone | E.164 when available |
| `email` | Email | Normalized |
| `state` | State | Normalized |
| `lead_type` | Lead Type | Niche display name (`@sa360/shared`) |
| `source` | Source | Customer-safe portal label (`portal-labels.ts`) |
| `campaign` | Campaign | Attribution campaign **name** (not internal id) |
| `form` | Form | Funnel/form display name when present |
| `order_number` | Order | `LeadOrder.orderNumber` |

Optional Phase 1.1 (omit if blank across the write): `zip`, niche-specific buyer
CSV fields already allowlisted (vet/trucker/etc.). Never a reason to block
delivery if missing.

**Lookup key for idempotency:** `sa360_instruction_id` (unique per planned
destination write). `sa360_lead_id` is customer-visible but a lead could
theoretically be re-delivered under a new instruction (replacement); instruction
id is the fulfillment identity.

### J.2 Idempotency strategy

Retries **must not** append duplicate rows.

Layered:

1. **LF2 attempt uniqueness** — `DeliveryAttempt.idempotencyKey`
   `delivery_attempt:{instructionId}:{attemptNumber}:{mode}:{policyVersion}`.
   Retries increment `attemptNumber`; this does not by itself prevent a second
   Google append.
2. **Success short-circuit** — if any attempt for this instruction is already
   `succeeded`, skip Google and return success (idempotent replay).
3. **Sheet lookup before append** — `values.get` the `sa360_instruction_id`
   column (or `spreadsheets.values.get` with a bounded range). If the instruction
   id exists, treat as success, set `externalReference` to
   `{spreadsheetId}:{worksheetId}:{rowNumber}`, do not append.
4. **Append only when absent** — `spreadsheets.values.append` with
   `INSERT_ROWS`.
5. **unknown_outcome** — if the HTTP call started and the result is ambiguous
   (timeout after send), do **not** auto-append on retry. Operator/review path:
   lookup by instruction id; if found, commit success; if not, a **manual**
   re-run is allowed. This matches LF2: `unknown_outcome` is not auto-retried
   (`docs/adr/lf2-fulfillment-reservation-v1.md`).

**Update-or-append:** Phase 1 is **append-if-absent**, not update-in-place.
Customer-edited cells must not be overwritten by a retry. Replacements are a new
instruction / new row.

Race (two in-flight claims) is already blocked by the partial unique index on
active `DeliveryAttempt` statuses `{claimed, in_progress}`.

---

## K. Worker / retry design

### K.1 Prefer existing execution architecture

| Phase | How writes run |
| --- | --- |
| 1 (this design’s first live PRs) | Manual admin canary, same shape as GHL PR B: preflight + execute endpoints. Worker stays shadow-planning only. |
| 1b (after canary) | New **work type** on existing `FulfillmentOutbox` (e.g. `sheets_delivery_v1`), processed through the existing worker → API internal route pattern. **No new queue.** |
| Never | A dedicated Sheets orchestrator, intake hook, or parallel attempt table |

Do not auto-promote intake → live Sheets in Phase 1. GHL ADR non-goal
(“No automatic fulfillment”) applies until Sheets canary is proven.

### K.2 Error classification

| Failure | Retryable? | Instruction / allocation | Connection flag |
| --- | --- | --- | --- |
| Revoked OAuth / invalid_grant | No | `review_required` | `reconnect_required` |
| Access token expired | N/A | Refresh then retry once in-process | — |
| Refresh 5xx / 429 | Yes | `retryable_failure` | — |
| Spreadsheet deleted (404) | No | `review_required` | destination not ready |
| Permission removed (403) | No | `review_required` | destination not ready; maybe reconnect |
| Tab renamed | Recover if `worksheetId` (gid) still exists; else review | — |
| Tab deleted | No | `review_required` | — |
| Google 429 | Yes (honor `Retry-After`) | `retryable_failure` | — |
| Google 5xx | Yes | `retryable_failure` | — |
| Malformed / incompatible header | No | `review_required` | — |
| Duplicate retry after success | Skip write | keep `completed` | — |
| Timeout **before** request sent | Yes | retryable | — |
| Timeout **after** request sent | **unknown_outcome** | no auto-retry | operator lookup |
| Network error with uncertain send | **unknown_outcome** | no auto-retry | — |

Map these onto existing `DeliveryExecutionResult` statuses
(`succeeded`, `retryable_failure`, `terminal_pre_send_failure`, `unknown_outcome`).
Do not add a Sheets-only outcome enum.

---

## L. Customer portal changes

Smallest additive surfaces. No portal redesign. Portal lane must not invent
write UX without the APIs above.

### L.1 `/portal/account` — Integrations strip

Add a section on the existing account page (not a new IA):

- Google: disconnected / connected (`googleEmail`) / reconnect required
- Connect / Reconnect / Disconnect
- After connected: spreadsheet URL/ID, tab select, Create spreadsheet, Test,
  Save destination, Active/inactive (read-only if operator-gated)

Keep GHL plumbing hidden (current tests assert Account has no GHL connection card).

### L.2 Orders / leads

Reuse existing delivery pills (`GET /client/v1/lead-delivery`). Add Sheets-specific
copy only if the API distinguishes destination adapter failure
(`reconnect_required` vs generic failed). Do not add a second lead list.

CSV “Download spreadsheet” stays.

### L.3 Feature flag

Hide the integrations strip unless `SA360_GOOGLE_OAUTH_ENABLED` (API) and a
portal-safe exposure (server-fetched, not a public “how to hack OAuth” flag).
Default off.

---

## M. Admin C.O.C. changes

Operators need visibility, not a second console.

| Attach to | Add |
| --- | --- |
| `/clients/[id]` or `/clients/[id]/delivery-config` | Google connection status, email, `reconnect_required`, spreadsheet id/title/tab, target enabled, last successful delivery |
| `/ghl-connections` analog or same client page | Probe / disconnect Google (admin) |
| `/fulfillment-ops` Live attempts | `google_sheets.v1` attempts, success/failure, error codes |
| New canary routes | `.../instructions/:id/sheets-live/canary/preflight` and `.../canary` mirroring GHL |

Do not reuse the GHL OAuth start button for Google. Do not surface tokens.
Delivery failures KPI on `/lead-fulfillment` is already “not wired yet” — optional
follow-up, not Phase 1 blocking.

---

## N. Security risks

| Risk | Mitigation |
| --- | --- |
| Tokens on customer model / metadata | Dedicated encrypted table; metadata validator reject list |
| Plaintext Meta-style tokens | Do not copy `ClientConfig.metaAccessToken` |
| Cross-tenant sheet access | Connection and target both keyed by `clientAccountId`; resolve token only for that tenant; never accept another client’s `connectionRefId` |
| Caller-supplied tenant on OAuth start | Session/BFF is source of truth; pending row + signed state |
| Callback mix-up with GHL | Distinct path `/integrations/google/oauth/callback` |
| Open redirect | `returnTo` allowlist |
| PKCE downgrade | Store verifier encrypted; required on exchange |
| Refresh stampede | `tokenVersion` CAS |
| Token leakage in logs/API | Reuse GHL denylist presenters + callback log redaction; never `NEXT_PUBLIC` secrets |
| Frontend secret exposure | Presenters omit all token fields; `assertNoTokenFieldsInPayload` |
| CSRF | Signed state + one-time pending row |
| Logging request/response JSON on attempts | Store spreadsheet id, row number, status codes — never access tokens or full sheet dumps |
| Disabled target still writable | `deliverLive` re-validates enabled + flags + tenant |
| Customer pastes another tenant’s sheet id | Writes use **their** OAuth token; they can only write sheets **they** can access. Still bind destination to their connection. |
| Scope creep | Refuse Drive.readonly in Phase 1 |
| Test-mode 7-day refresh expiry | Document as canary operational risk |

---

## O. Feature flags / rollout

Deny-by-default, copied from LF2 GHL canary (`SA360_LF2_EXECUTION_ENABLED`,
`SA360_LF2_GHL_CANARY_ENABLED`, allowlists).

| Stage | Gates |
| --- | --- |
| Disabled | All flags unset/false. UI hidden. Adapter `deliverLive` refuse. |
| Local fixture/mock | Tests use fake Google HTTP. No real tokens. `SA360_GOOGLE_OAUTH_ENABLED` in local `.env` only if exercising the flow. |
| Sam internal | OAuth enabled. Canary enabled. `SA360_LF2_SHEETS_ALLOWED_CLIENT_IDS` = Sam’s `clientAccountId`. Manual canary only. |
| One controlled customer | Add that id to the allowlist. Still manual or tightly gated auto. |
| Wider | OAuth verification completed. Allowlist expanded or replaced by `deliveryEnabled` on target **plus** a global kill switch. |

Do **not** reuse `backup_sheet_export.mode` or `SA360_PPL_CSV_EXPORT_ENABLED` as
the Sheets API switch. CSV export stays independently gated.

Suggested flags:

```text
SA360_GOOGLE_OAUTH_ENABLED=false
SA360_GOOGLE_SHEETS_DESTINATION_ENABLED=false
SA360_LF2_SHEETS_CANARY_ENABLED=false
SA360_LF2_SHEETS_ALLOWED_CLIENT_IDS=
SA360_LF2_SHEETS_ALLOWED_ORDER_IDS=
SA360_LF2_SHEETS_AUTO_EXECUTE=false
```

`SA360_LF2_EXECUTION_ENABLED` remains the master LF2 execution ceiling; Sheets
must fail closed if it is off.

---

## P. Test matrix

No live Google calls in CI. Fake `fetch` / fixture transport (same pattern as GHL
OAuth client tests).

| Area | Tests |
| --- | --- |
| Encryption | Round-trip; refuse missing key; never log plaintext |
| OAuth state | Sign/verify, expiry, tamper, tenant mismatch |
| Pending auth | Single consume; expired; PKCE verifier required |
| Callback | Distinct from GHL path; bad state; missing code; Google error query |
| Presenters | Token field denylist; portal/admin payloads |
| Tenant isolation | Client A cannot resolve/test Client B’s connection or spreadsheet id via API |
| Metadata validation | Reject `accessToken` / `oauth` keys in `configMetadataJson` |
| Planning | `google_sheets.v1` ready iff spreadsheetId + connectionRefId; unreadiness fail-closed |
| Simulate | Builds row payload; `sheetsApiWrite: false` in sim |
| Live adapter (fake HTTP) | Append; skip append if instruction id exists; skip if prior success |
| 429/5xx | retryable; 401/403/404 terminal or reconnect_required |
| unknown_outcome | no second append without lookup |
| Disconnect | Ciphertext wiped; target disabled; subsequent deliverLive pre-send fail |
| Portal | Account strip hidden when flag off; no GHL card regression; connect CTA present when on |
| Admin | Status/probe/canary preflight deny-by-default |
| Intake unchanged | `sources-google-sheet` tests still shadow-only |

---

## Q. Smallest safe PR sequence

Derived from current architecture (not the suggested A–F labels). Each PR stays
flag-off mergeable.

| PR | Lane | Scope |
| --- | --- | --- |
| **0. This document** | — | Audit/design only |
| **1. Data + crypto foundation** | Auth/Account | `GoogleAccountConnection`, `GoogleOAuthPendingAuth`; generic encrypt helpers + `GOOGLE_TOKEN_ENCRYPTION_KEY`; no routes that call Google |
| **2. Google OAuth connection** | Auth/Account | Start/callback/disconnect/status; PKCE; presenters; flags default off; portal API status/start/disconnect |
| **3. Sheet resolve + DeliveryTarget config** | Auth/Account + API | URL parse, `spreadsheets.get`, create-once, test connection, upsert `google_sheets.v1` target; evolve planning validation |
| **4. Sheets execution adapter** | API (fulfillment) | `google-sheets-execution.adapter.ts`; register execution; simulate + fake live tests; **canary endpoints**; deny-by-default allowlists; **no auto worker** |
| **5. Portal UX** | Portal | Account integrations strip; wire BFF to PR 2–3 APIs; hide when flags off |
| **6. Admin C.O.C. visibility** | Quality / admin | Client Google status, attempts, reconnect_required, canary buttons |
| **7. Production canary** | Ops + code flags only | Google Cloud testing app, Sam allowlist, one manual live row, then one customer |
| **8. Optional auto-execute** | API + worker | New outbox `workType` on **existing** queue; `SA360_LF2_SHEETS_AUTO_EXECUTE`; only after canary evidence |

Do not combine 2+4+5. OAuth without a live writer is still a reviewable slice.
Do not put portal UI in the same PR as the first live append.

Lane reminder (`docs/development/PARALLEL_AGENT_WORK.md`): Ingestion must not
own this. Do not modify `sources-google-sheet` as part of Sheets **delivery**.
Portal must not invent backend writes. Migrations only in Auth/Account PRs.

---

## R. Human decisions needed before implementation

Recommended default in **bold**. Implementation should not proceed past PR 1
without 1–4.

1. **Phase 1 sheet mode:** **A (paste URL/ID) + create-once**, vs A-only, vs
   Drive picker. **Recommend A + create-once.**
2. **Live write posture:** **manual LF2 canary first** (like GHL), vs worker
   auto-execute in the first live PR. **Recommend canary first.**
3. **FREE dual path:** **keep CSV download and add Sheets push**, vs Sheets
   replaces CSV. **Recommend keep both.**
4. **PPL aged path:** **leave `markSpreadsheetDelivered` / CSV packages alone
   in Phase 1**, vs also append aged packages to Sheets. **Recommend leave
   PPL CSV path unchanged.**
5. **One Google account per `ClientAccount` in Phase 1?** **Yes.**
6. **GCP project / consent branding / test users** — human must create. Testing
   vs published (7-day token expiry in testing).
7. **Redirect hostnames** for staging/production API (exact URI allowlist).
8. **Encryption key:** dedicated `GOOGLE_TOKEN_ENCRYPTION_KEY` vs reuse GHL key.
   **Recommend dedicated.**
9. **Should PRO GHL clients also get Sheets as a backup destination?** Phase 1
   **no dual-write** unless an operator enables two required targets.
10. **Legacy `backupSheetId` / `write_backup_sheet`:** **freeze**; do not
    migrate those ids into `DeliveryTarget` automatically (they were GHL-adjacent
    placeholders, likely unused live).
11. **OAuth app verification timeline** before any wider-than-canary rollout.
12. **Whether portal Connect is customer self-serve immediately, or operator
    enables Google per client first.** **Recommend flag + client allowlist even
    for the Connect button.**

---

## Approach A vs B (decision record)

| | A. Customer selects existing sheet | B. SA360 creates/manages a sheet |
| --- | --- | --- |
| OAuth scopes | `spreadsheets` only | `spreadsheets` only for create-once |
| UX | Paste URL/ID + confirm tab | One button; less customer error |
| Failure modes | Wrong file, no permission, messy headers | Orphaned files on disconnect; “managed” schema repair |
| Verification | Same sensitive scope | Same |
| Speed | Fastest if customer already has a sheet | Fast once OAuth exists |

**Phase 1: both, but B is create-once, not a managed-document product.** Drive
listing / Picker is a Phase 2 UX upgrade (`drive.file` + Picker API key), not an
MVP blocker.

---

## Explicit non-goals (Phase 1)

- Meta Lead Ads work resumption
- Production DigitalOcean / DNS / Google Cloud changes in code PRs
- Replacing LF2 or PPL CSV
- Webhook/CRM FREE-tier delivery
- Broad Drive access
- Automatic fulfillment worker before canary
- Using inbound Google Sheet intake as a destination
- Tokens in `DeliveryTarget` or `ClientAccount`

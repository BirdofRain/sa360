# Meta Lead Ads direct intake — One-Page pilot runbook

Status: **prepared, not activated.** Nothing in this document has been executed against
production. Every step that touches Meta, DigitalOcean, or a production Page is an operator
action that requires explicit authorization. This runbook does not merge, deploy, change
production settings, subscribe Pages, or disable Zaps.

Scope: receive native Facebook/Instagram Instant Form leads **directly** from Meta
(signed `leadgen` notification → durable receipt → queued Graph retrieval → normalized
capture → exact Page ID + Form ID client association). Capture and association never
require a master client or GHL configuration. Routing, delivery, CAPI, and inventory
enrollment stay **disabled** for this pilot and are activated separately.

LeadCapture website forms keep their own intake path and are out of scope.

---

## 1. What exists vs. what this PR changes

### Existing (before this PR)

| Capability | Where |
| --- | --- |
| Signed Meta webhook (`X-Hub-Signature-256`, HMAC-SHA256 over raw body) with fail-closed production behaviour when `META_APP_SECRET` is unset (503 `integration_not_configured`) | `apps/api/src/lib/meta-webhook.ts`, `apps/api/src/routes/sources-facebook.ts` |
| Verification handshake (`GET` with `hub.mode`/`hub.verify_token`/`hub.challenge`) on both callback routes | same |
| Canonical identity `facebook` / `meta_lead_ads` / `leadgen_id`; `sourceLeadUid = facebook-meta_lead_ads-{id}`; advisory-lock claim (`claimSourceLeadEventByCanonicalIdentity`) | `apps/api/src/repositories/source-lead-event.repository.ts` |
| BullMQ queue `META_LEADGEN_FETCH_QUEUE`, jobId `meta-leadgen-fetch-<leadgenId>`, 5 attempts, exponential backoff 60 s, `removeOnFail: false` | `apps/api/src/services/source-intake/meta-leadgen-fetch-queue.service.ts` |
| Worker processor: thin dispatcher that POSTs `/admin/v1/meta-leadgen/internal/process-fetch` with `x-sa360-admin-key` | `apps/worker/src/processors/meta-leadgen-fetch.processor.ts` |
| Graph fetch `GET /{version}/{leadgen_id}` with retryable/auth classification | `apps/api/src/services/source-intake/meta-lead-graph.service.ts` |
| Zapier-first capture-only path (`sa360.facebook_capture.v1`) with Page+Form association via `SourceFunnel` (`providerFunnelId = fbpage:{pageId}:fbform:{formId}`) | `zapier-facebook-capture.service.ts`, `facebook-form-association*.ts` |
| Admin association endpoints: `GET/POST /admin/v1/facebook-form-associations`, `POST /admin/v1/facebook-capture/events/:id/reevaluate-association` | `apps/api/src/routes/admin-facebook-capture.ts` |
| Admin C.O.C. **Facebook Intake** page and **Source Intake** list/drawer | `apps/admin-coc/src/app/(dashboard)/facebook-intake`, `source-intake` |

### Gaps closed by this PR

| Gap | Fix |
| --- | --- |
| Meta-first leads could only be settled through the **routing** path (required a master client). With routing disabled they stayed `received` forever. | New `settleMetaLeadCapture` (`meta-lead-capture.service.ts`): when `SA360_META_LEAD_ADS_ROUTING_ENABLED` is not true the Graph result is settled as a **capture-only** submission with Page+Form association, identical in shape to Zapier-first capture but with `intakeMethod = meta_lead_ads`, `intakeProvenance = meta`. No Zapier provenance is fabricated. |
| Default Graph version `v22.0` while the app is on `v25.0`. | `DEFAULT_GRAPH_API_VERSION = "v25.0"`; `META_GRAPH_API_VERSION` overrides. |
| One Page token was assumed to read every Page. | `META_PAGE_ACCESS_TOKEN_PAGE_ID` binds the token to a Page; `resolveMetaPageAccessToken` returns `token_unavailable` (terminal, with an actionable diagnostic) when a notification arrives for a different Page. |
| Graph rate limits (`4`, `17`, `32`, `613`, `80000–80014`, `is_transient`) and some 4xx bodies were not classified as retryable; permission (`10`, `200–299`) and expired (`190`) tokens were not described to operators. | `classifyMetaGraphResult` reordered to inspect body codes first; `describeMetaGraphFailure` writes a token-free operator summary. |
| Graph requests did not send `appsecret_proof`. | Added when `META_APP_SECRET` is set. |
| Webhook post-enqueue bookkeeping replaced `enrichmentMetadataJson` outside the canonical lock and redeliveries overwrote `rawPayloadJson`/`errorSummary`. | Lock-safe `mergeMetaLeadgenFetchMeta` and `recordMetaNotificationRedelivery` (redelivery count, last envelope, last webhook log id; original raw notification preserved). |
| Terminal job failures (`failed`, `enqueue_failed`) had no operator recovery short of a manual DB edit. | `POST /admin/v1/meta-leadgen/events/:sourceEventId/requeue-fetch` + `requeueMetaLeadgenFetch` (removes stale BullMQ job, re-adds). Refuses settled/in-flight rows (409). |
| C.O.C. could not distinguish the **source client** (association) from the **delivery destination** (routing), and had no Graph fetch visibility. | Source-leads presenter emits `captureOnly`, `intakeMethod`, `sourceClientAccountId`, `associationOutcome`, `metaLeadgenFetch`; `destinationClientAccountId` is `null` for capture-only rows. Webhook detail adds a token-free **Meta Graph fetch** section. Source Intake gains a **Source client** column, a Meta Graph fetch block, and a **Requeue Meta Graph fetch** button. |

No migrations. No change to inventory, delivery, CAPI, routing rules, or the legacy
`FACEBOOK_DIRECT_INTAKE_ENABLED` alias (which still enables routing and must **not** be used).

---

## 2. Meta setup runbook (operator, not automated)

App ID: `1641287293781686`. Business verification is complete. App Review status, live mode,
token permissions, Page access, and Page subscription are **unverified** and must be checked,
not assumed. Never paste tokens or the app secret into tickets, chat, logs, or this repo.

### 2.1 Callback verification

1. Callback URL (production API): `https://sa360-sw6oq.ondigitalocean.app/sources/facebook/lead-created`
   (alias `/webhooks/meta/leadgen` also exists; register only one).
2. In Meta App Dashboard → **Webhooks** → product **Page** → *Edit subscription*:
   - Callback URL as above.
   - Verify token = the value of `META_WEBHOOK_VERIFY_TOKEN` on the **API** component.
3. Meta issues `GET …?hub.mode=subscribe&hub.verify_token=…&hub.challenge=…`. The API answers
   `200 text/plain <challenge>` and logs `processingStatus=handshake_ok`
   (`eventNameInternal=meta_leadgen_handshake`). A wrong token returns `403 verification_failed`
   and logs `handshake_denied`.
4. Subscribe to the **`leadgen`** field only.
5. Read back in C.O.C. → **Webhooks** (route `/sources/facebook/lead-created`) that the handshake
   log exists. Nothing else is written by the handshake.

### 2.2 Permission and access checks

Required for lead retrieval with a Page token:

| Permission | Why |
| --- | --- |
| `leads_retrieval` | Read `/{leadgen_id}` |
| `pages_show_list` | Enumerate Pages the user/system user can see |
| `pages_read_engagement` | Read Page-level leadgen metadata |
| `pages_manage_ads` | Required by Meta for leadgen webhooks and lead access on the Page |
| `pages_manage_metadata` | Required to call `/{page-id}/subscribed_apps` |

Checks (run with the operator's own user token in Graph Explorer, do not store output
containing tokens):

```text
GET /me/permissions                         → each permission above status=granted
GET /me/accounts?fields=id,name,tasks       → Page 102720336121632 present with MANAGE/ADVERTISE
GET /{app-id}?fields=name,link,app_type     → confirms the app id you are configuring
GET /debug_token?input_token=<PAGE_TOKEN>   → app_id matches 1641287293781686, scopes include
                                              leads_retrieval, pages_manage_ads; note expires_at
```

Until App Review approves `leads_retrieval` for live mode, Graph retrieval works **only** for
users with a role on the app (admin/developer/tester) and only while the app is in development
mode or for test/role users. Plan the pilot with a role-holding Page admin.

### 2.3 Page subscription + readback

Subscribing a Page is a production change: **do it only when the pilot is authorized.**

```text
POST /{page-id}/subscribed_apps?subscribed_fields=leadgen        (Page access token)
GET  /{page-id}/subscribed_apps                                   → data[].subscribed_fields ∋ "leadgen"
```

If `GET` shows no `leadgen`, the webhook will never fire for that Page regardless of the App
Dashboard subscription.

### 2.4 Test-lead retrieval

Two independent tests:

1. **Fixture test (no Meta credentials):** with `SA360_META_LEAD_ADS_FIXTURE_ENABLED=true` on the
   API (dev/staging only — the route is unauthenticated and must stay `false` in production),
   `POST /sources/facebook/test-lead` with a JSON body of Instant Form fields. Expect `200` with
   `captureOutcome=captured` and a Source Intake row `captureOnly=true`, `intakeMethod=meta_lead_ads`.
2. **Real test lead:** Meta **Lead Ads Testing Tool** (`business.facebook.com/ads/lead_gen/tool_testing`)
   → select Page + Form → *Create lead*. This triggers a real `leadgen` webhook; the Graph fetch
   must return the test lead (`is_test_lead`-style field data). Test leads are retained for a
   short time by Meta; fetch promptly or requeue.

### 2.5 Token strategy

- **Pilot (single Page):** a long-lived **Page access token** for Page `102720336121632`
  (obtain via a long-lived user token → `GET /me/accounts`). Set `META_PAGE_ACCESS_TOKEN` and
  `META_PAGE_ACCESS_TOKEN_PAGE_ID=102720336121632` on the **API** component only. Page tokens
  derived from long-lived user tokens do not expire unless the user's password/session changes
  or permissions are revoked. `GET /debug_token` confirms.
- **Why Page-bound:** a notification for any other Page now settles as
  `graphOutcome=token_unavailable` with an explanation instead of a confusing OAuth error. The
  raw notification is retained and can be requeued once a token exists.
- **Multi-Page (not in this PR):** requires a **System User token** from the Business Manager
  with the Pages assigned, or per-Page tokens persisted in the database (new table/columns →
  Auth/Account lane migration). The code path that must grow is `resolveMetaPageAccessToken`;
  no other code assumes a single Page.

---

## 3. DigitalOcean environment (prepared, not applied)

All values are **plain env unless marked SECRET**. Safe defaults are the values that keep the
pipeline inert. Never set `FACEBOOK_DIRECT_INTAKE_ENABLED` — it enables routing too.

### 3.1 API component (`apps/api`)

| Variable | Safe default | Pilot value | Notes |
| --- | --- | --- | --- |
| `META_APP_SECRET` | unset → **503** on callback in production (fail closed) | SECRET | Required for signature validation and `appsecret_proof`. |
| `META_WEBHOOK_VERIFY_TOKEN` | unset → handshake denied | random 32+ chars | Shared only with Meta App Dashboard. |
| `META_PAGE_ACCESS_TOKEN` | unset → `token_unavailable` | SECRET Page token | See §2.5. |
| `META_PAGE_ACCESS_TOKEN_PAGE_ID` | unset → token treated as unbound | `102720336121632` | Binds token to the pilot Page. |
| `META_GRAPH_API_VERSION` | `v25.0` (code default) | leave unset | Override only if Meta deprecates. |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | `false` → raw stored, no enqueue | `true` | Step 3 of activation order. |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | `false` → raw stored, no enqueue | `true` | Step 3. |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | `false` | **`false`** | Must stay false for the pilot. True would route/deliver and require a master client. |
| `SA360_META_LEAD_ADS_FIXTURE_ENABLED` | `false` | **`false`** in production | Unauthenticated fixture route. Dev/staging only. |
| `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED` | `false` → association skipped (`association_disabled`), capture still retained | `true` | Already governs Zapier-first association; same flag for Meta-first. |
| `SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID` | unset | leave unset | Only used by the routing path; not needed for capture. |
| `FACEBOOK_DIRECT_INTAKE_ENABLED` | unset | **never set** | Legacy alias = intake+graph+**routing**. |
| `ADMIN_API_KEY` (or `SA360_ADMIN_KEY`) | existing | existing | Worker → API internal auth and admin-coc proxies. |
| `REDIS_URL` | existing | existing | BullMQ queue. |
| `DATABASE_URL` | existing | existing | — |

### 3.2 Worker component (`apps/worker`)

| Variable | Safe default | Pilot value | Notes |
| --- | --- | --- | --- |
| `REDIS_URL` | existing | existing | Same Redis as the API. |
| `SA360_API_INTERNAL_URL` | unset → processor throws in production | `https://sa360-sw6oq.ondigitalocean.app` (or DO internal hostname, no trailing slash) | Worker POSTs `{url}/admin/v1/meta-leadgen/internal/process-fetch`. |
| `ADMIN_API_KEY` (or `SA360_ADMIN_KEY`) | unset → processor throws | same as API | Sent as `x-sa360-admin-key`. |
| `META_LEADGEN_FETCH_CONCURRENCY` | `2` | `2` | — |

The worker holds **no Meta credentials**; all Graph access happens inside the API process.

### 3.3 Admin C.O.C. component (`apps/admin-coc`)

No new variables. Requeue and association actions use the existing `SA360_ADMIN_API_KEY` proxy.

### 3.4 Activation order (each step reversible)

1. Deploy the PR with all flags at **safe defaults** (behaviour unchanged for existing traffic).
2. Set `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` on the API. Complete §2.1 handshake.
   Observe `handshake_ok` in C.O.C. Webhooks. **No leads are processed yet.**
3. Set `META_PAGE_ACCESS_TOKEN`, `META_PAGE_ACCESS_TOKEN_PAGE_ID`. Verify `GET /debug_token` offline.
4. Confirm the Page+Form association exists (§4.2). Set `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED=true`
   if not already (it is shared with the Zapier-first path — check current production value first).
5. Set `SA360_META_LEAD_ADS_INTAKE_ENABLED=true` and `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=true`.
   From this point notifications are enqueued.
6. Subscribe the pilot Page (§2.3). Create a test lead (§2.4 step 2). Check §4.3 success criteria.
7. Leave `SA360_META_LEAD_ADS_ROUTING_ENABLED=false`. Delivery remains an explicit separate step.

---

## 4. One-Page pilot procedure

### 4.1 Candidate (operator must verify before use)

| Item | Candidate value | Verification |
| --- | --- | --- |
| Page ID | `102720336121632` | `GET /me/accounts` shows it; Business Manager ownership confirmed |
| Form ID | `1149211490298917` | `GET /{page-id}/leadgen_forms` lists it with `status=ACTIVE` |
| Client | Danielle Cohen's existing `ClientAccount` | Look up `clientAccountId` in C.O.C. → Clients. Do **not** create a new client. |

### 4.2 Create the association (idempotent)

```http
POST /admin/v1/facebook-form-associations
x-sa360-admin-key: <ADMIN_API_KEY>
Content-Type: application/json

{ "pageId": "102720336121632", "formId": "1149211490298917", "clientAccountId": "<danielle_client_account_id>" }
```

Expect `201` (created) or `200` (already confirmed). A `409 association_conflict` means the
form is already bound to a different client — stop and resolve with the account owner. Read back
with `GET /admin/v1/facebook-form-associations`.

If Zapier still forwards the same form, both paths associate to the same client via the same
`SourceFunnel` row; whichever arrives first settles the submission, the second is bookkept
(`captureOutcome=already_settled`). No contact-level dedup is performed; two different
`leadgen_id`s with identical contact data remain two submissions.

### 4.3 Success criteria (observable, per test lead)

| # | Where | Expected |
| --- | --- | --- |
| 1 | C.O.C. → Webhooks → `/sources/facebook/lead-created` | `processingStatus=queued`, HTTP 200, signature valid |
| 2 | Source Intake row (`system=meta_lead_ads`) | Status badge `captured · normalized`; Graph badge not shown once settled |
| 3 | Drawer → **Meta Graph fetch** | state `captured`, `graphOutcome=ok`, `tokenScope=page_bound`, attempt `1` |
| 4 | Drawer → **Capture, association…** | Capture `Capture only · meta_lead_ads`; Association `associated`; **Source client** = Danielle's id; **Delivery destination** = `none` |
| 5 | Drawer → normalized payload / enrichment | `schema_version=sa360.facebook_capture.v1`, `source.intake_method=meta_lead_ads`, `submitted_at` = Meta `created_time`, field data and custom answers present; enrichment `intakeProvenance=meta` |
| 6 | Inventory | `inventoryTracked=false`, reason "not tracked" — **no** `InventoryLead` row |
| 7 | Delivery | `deliveryThisRequestAttempted=false`; no GHL/CAPI dispatch log |
| 8 | Webhooks → row detail | **Meta Graph fetch** section shows `live_delivery=false`, `capi_dispatched=false` |

Run at least: one Testing Tool lead; one redelivery (Testing Tool *Resend* or Meta retry) →
`redelivery.count=1`, row unchanged; one lead on a **different** Page (if available) →
`token_unavailable` with diagnostic, raw retained.

### 4.4 Reconciliation and recovery

| Symptom | Diagnosis | Recovery |
| --- | --- | --- |
| Row `received`, Graph state `enqueue_failed` | Redis unavailable at receipt | Fix Redis; C.O.C. → **Requeue Meta Graph fetch** (or `POST /admin/v1/meta-leadgen/events/:id/requeue-fetch`) |
| Graph state `failed`, `graphOutcome=auth_failure`, code `190` | Token expired/revoked | Rotate `META_PAGE_ACCESS_TOKEN`, restart API, requeue |
| `auth_failure`, code `200`/`10` | Missing `leads_retrieval`/`pages_manage_ads` or app not approved | Fix permissions (§2.2), requeue |
| `graphOutcome=token_unavailable` | Notification for a Page other than `META_PAGE_ACCESS_TOKEN_PAGE_ID` | Expected for non-pilot Pages; retain. Multi-Page needs §2.5 |
| `retryable` exhausted after 5 attempts (`failed`, codes `4`/`17`/`32`/`613`) | Rate limit | Wait, requeue |
| `associationOutcome=unmatched` | No confirmed `SourceFunnel` for Page+Form | §4.2, then `POST /admin/v1/facebook-capture/events/:id/reevaluate-association` |
| `associationOutcome=association_disabled` | `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED` not true | Set flag, reevaluate association |
| Lead in Testing Tool but no webhook row | Page not subscribed (§2.3) or callback not verified | Readback `GET /{page-id}/subscribed_apps` |
| Duplicate row suspected | Check `sourceLeadUid`; same `leadgen_id` is always one row | None needed |

Requeue is refused (409) when the row is already settled, processing, or has a live job; this is
the intended guard, not an error.

### 4.5 Rollback (any step, in reverse)

1. `SA360_META_LEAD_ADS_INTAKE_ENABLED=false` (or `…GRAPH_FETCH_ENABLED=false`): notifications are
   still signed, verified, and **stored raw** — nothing is enqueued. Zero data loss; requeue later.
2. Unsubscribe the Page: `DELETE /{page-id}/subscribed_apps` (Page token). Stops notifications.
3. Remove `META_PAGE_ACCESS_TOKEN*`: outstanding jobs settle as `token_unavailable`, rows retained.
4. Leaving `META_APP_SECRET` in place keeps the callback fail-closed and verifiable.

Existing Zaps are **not** touched by any step above; they continue to operate independently.

---

## 5. App Review and demo prerequisites

Before submitting `leads_retrieval`, `pages_manage_ads`, `pages_read_engagement`,
`pages_show_list`, `pages_manage_metadata` for Advanced Access:

1. **Live, verified callback** (§2.1) on a production URL — done via this pilot.
2. **Screencast** showing: a Page admin logging in, the Page+Form association in C.O.C., a test
   lead created in the Testing Tool, the Source Intake row showing capture + association, and
   (explicitly) that no outbound delivery occurs. Record from a staging account; never show tokens.
3. **Privacy Policy URL** and **Terms URL** reachable without login.
4. **Data Deletion Instructions URL** — a real public page (not a placeholder) that explains how
   a lead or Page admin requests deletion of data SA360 holds about them, what is deleted
   (`SourceLeadEvent` raw + normalized payloads, webhook request logs, any derived contact),
   the response SLA, and a contact channel. Meta also accepts a *Data Deletion Request Callback*;
   if implemented later it must verify Meta's `signed_request` with `META_APP_SECRET` and return
   `{ url, confirmation_code }`. This is a Portal-lane deliverable and is **not** in this PR.
5. **App Icon, Category, Business use case** text consistent with "lead intake for client CRM".
6. **Test user with a role** on the app and admin on the pilot Page so reviewers can reproduce.
7. Confirm **Business verification** is still green and the app is linked to the verified
   Business Manager.

Until approval, only role-holding users' Pages work; plan the pilot accordingly.

---

## 6. Verification performed for this PR (local, isolated DB only)

Synthetic fixtures against local `sa360_test` Postgres and local Redis (`127.0.0.1`). Covered:

- signature rejection (bad/missing signature; missing secret → 503 in production)
- handshake accept/deny
- enqueue failure → `enqueue_failed` + diagnostic; successful enqueue → `queued`; skipped enqueue leaves state untouched
- Graph permission (`200`), expired (`190`, `463`), rate limit (`4`/`17`/`32`/`613`/`80004`), transient classification
- Page-bound token mismatch → `token_unavailable`; match → fetch proceeds
- Meta-first association parity with Zapier-first; missing association retained with diagnostic; association disabled
- same `leadgen_id` redelivery → bookkept, no re-claim, raw preserved
- concurrent Meta/Zapier for one lead → single settle, second `already_settled`
- two different `leadgen_id`s with identical contact data on two client forms → two submissions, two clients
- no inventory or delivery side effects in every capture test

See the PR description for exact command output.

# Post-#179 release validation and environment audit — 2026-10-14

Read-only production audit plus synthetic tests on the local disposable
`127.0.0.1` databases. **No production environment variables, migrations,
customer rows, inventory, or DigitalOcean configuration were changed.**

Merged stack on `origin/master`:

| PR | Title | Merge commit | Merged at (UTC) |
| --- | --- | --- | --- |
| #177 | Harden commercial PPL buyer-ready phone and name quality | `82d4a4e4cf27d3a7a32147c9b4640b1ae91508ce` | 2026-10-13T20:52:15Z |
| #178 | Operator review buffers and unbilled supplemental fills | `0767f175af9fff61b7f29e604becf05f3037584c` | 2026-10-14T13:19:51Z |
| #179 | External delivery receipts: unmatched confirmation, fail-closed suppression, OR-identity grouping | `2e2a9e1ad2d913f0bdabd642ce200b37b0c25512` | 2026-10-14T14:46:55Z |

## Final call

**API is on #179 and healthy.** Local schema lock is 84/84 including the
operator-review and receipt migrations. Synthetic operator-review and
receipt suites pass, including the first-controlled **3 purchased + 1
unbilled buffer** path.

**Do not start Alex's first live order until the operator screenshots
below confirm feature-flag placement and the debug-route finding is
closed.** The production API currently exposes unauthenticated mutating
debug routes. Effective Fulfillment Ops flags cannot be read without an
admin key or DigitalOcean console access.

---

## Phase A — release and environment audit

### 1. Current master and deployed revisions

| Surface | Observed | Evidence |
| --- | --- | --- |
| `origin/master` | `2e2a9e1` (#179) | `git fetch origin master` |
| Production API | `https://sa360-sw6oq.ondigitalocean.app` | existing runbooks |
| API `/health` | `200`, `commitSha=2e2a9e1ad2d913f0bdabd642ce200b37b0c25512`, `commitShort=2e2a9e1`, `buildSource=SA360_BUILD_COMMIT_SHA` | public GET |
| API App Platform origin | `6b232bd6-4dde-4a2a-8790-8527a60c3816` (`x-do-app-origin`) | response header |
| Admin C.O.C. | `https://sa360-api-staging-coo57.ondigitalocean.app` | `/api/health` `200` `{ok:true,service:admin-coc}` |
| Admin C.O.C. origin | `2d056010-3c47-4054-81c0-cb3904f40811` | response header |
| Admin C.O.C. commit | **Unknown from public pages** | login HTML has Next build id `OjWnB6w5u9n7Fiw0KFsCd`; `NEXT_PUBLIC_SA360_BUILD_COMMIT_*` is not present on `/login` |
| Worker revision | **Unknown** | no public health; no DigitalOcean token / `doctl` |

The two App Platform apps are separate: API origin ≠ Admin C.O.C. origin.
That matches the requested `sa360` vs `sa360-admin-coc` split.

### 2. Production migration status

**Not directly confirmed.** This environment has no authorized production
Postgres credentials, no DigitalOcean API token, and no App Platform job
logs. `doctl` is not installed. GitHub Actions has no deploy workflows
(DigitalOcean auto-deploy is the path).

Indirect evidence that production is not crash-looping on missing
receipt tables:

- API process is serving `/health`, `/health/db`, and `/health/queue` on
  commit `2e2a9e1`.
- #179 fail-closes buyer fulfillment when `BuyerExternalDeliveryReceipt`
  cannot be read. A missing table would not by itself take `/health/db`
  down (that query is `SELECT 1`).

**Operator screenshot required** (one of):

1. App Platform app `sa360` → `sa360-migrate` PRE_DEPLOY job for the
   `2e2a9e1` deployment: `84 migrations found` and
   `Database schema is up to date!`
2. Or `pnpm exec prisma migrate status` against production **from an
   already-authorized operator machine** (do not run it from this agent).
3. Or a read-only listing of `_prisma_migrations` showing these four names
   as `applied`:

   - `20261013160000_ppl_operator_review_buffer_v1`
   - `20261013170000_ppl_external_delivery_receipt_v1`
   - `20261013180000_ppl_external_delivery_receipt_audit_v1`
   - `20261013190000_ppl_external_delivery_receipt_evidence_v1`

### 3. 84-migration schema (repo + local disposable DBs)

Repo `prisma/migrations` contains **84** directories. Schema lock test
asserts the operator-review and three receipt migrations.

Local `127.0.0.1` only:

| Database | Before this audit | After `prisma migrate deploy` |
| --- | --- | --- |
| `sa360` | 81 applied at environment boot (snapshot predating #179) | **84 / up to date** |
| `sa360_test` | same | **84 / up to date** |

Applied here (local only): `20261013170000`, `20261013180000`,
`20261013190000`. `20261013160000` was already present from boot.

Confirmed local tables: `PplOperatorReviewBatch`,
`BuyerExternalDeliveryReceipt`, `BuyerDeliveredIdentity` (unchanged
model; receipt apply still must not write it).

### 4–6. Feature-flag effective states

Code on the deployed SHA (`2e2a9e1`) resolves:

| Flag | Effective rule | Default if unset | Bootstrap field |
| --- | --- | --- | --- |
| `SA360_PPL_OPERATOR_REVIEW_ENABLED` | `=== "true"` | **false** | `safety.flags.SA360_PPL_OPERATOR_REVIEW_ENABLED` |
| `SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` | `=== "true"` | **false** | `safety.flags.SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` |
| `SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED` | `!== "false"` | **true** | `safety.flags.SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED` |

`GET /admin/v1/fulfillment-ops/bootstrap` and `/safety` return
`401 Unauthorized` without an admin key. This agent has no production
admin key (correct).

**Production effective values are therefore unverified.** If the operator
already set `SA360_PPL_OPERATOR_REVIEW_ENABLED=true` on **`sa360-api`
(RUN_TIME)** after activation, bootstrap will report `true` and Stage 2e
will render. Setting that flag only on `sa360-admin-coc` does nothing —
the workbench reads the API bootstrap.

**Operator screenshot required:** Fulfillment Ops safety badges **or**
the `sa360-api` component env list (names and true/false only, never
secret values) showing:

- `SA360_PPL_OPERATOR_REVIEW_ENABLED=true` on **sa360-api**
- `SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` **unset** (or not `true`)
- `SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED` **unset** (default on)
  or explicitly `true`. Do **not** set `false` if any applied receipts
  exist.

### 7. API / worker / Admin C.O.C. health

| Check | Result |
| --- | --- |
| API `/health` | `200` ok, #179 SHA |
| API `/health/db` | `200` `{ok:true,db:connected}` |
| API `/health/queue` | `200` `{ok:true,queue:PONG}` |
| Admin C.O.C. `/api/health` | `200` |
| Admin C.O.C. `/health` | `200` |
| `/fulfillment-ops` | `307` → `/login?next=%2Ffulfillment-ops` (password gate intact) |
| Worker process | **Operator screenshot required** (App Platform component running, no crash loop) |

### 8. Component-level vs app-level inheritance (no edits made)

Two apps, so inheritance does **not** cross the app boundary.

**App `sa360`** (API origin `6b232bd6-…`) typically has app-level vars
plus component overrides for `sa360-api`, `sa360-worker`, and
`sa360-migrate`.

Look for redundant pairs (report names only):

| Pattern | Risk | Recommendation |
| --- | --- | --- |
| Same key at app-level **and** on `sa360-api` | Component value wins; app-level is ignored for that component | Keep feature flags on **`sa360-api` only** (or app-level with no component override). Delete the unused copy. |
| Feature flags on `sa360-worker` | Worker does not read operator-review or receipt-import flags | Safe to omit on worker. Suppression is enforced on the API selection path. |
| Feature flags on `sa360-admin-coc` | Admin C.O.C. does not evaluate `SA360_PPL_*` itself | Do not set them there. Stage 2e/2f visibility comes from API bootstrap. |
| `SA360_BUILD_COMMIT_SHA` at app-level as `${_self.COMMIT_HASH}` | Invalid at app-level | App-level: `${sa360-api.COMMIT_HASH}` / `${sa360-worker.COMMIT_HASH}`. Component-level: `${_self.COMMIT_HASH}`. API `/health` already shows `buildSource=SA360_BUILD_COMMIT_SHA`, so the API binding works. |
| `ADMIN_API_KEY` **and** `SA360_ADMIN_KEY` both set | Two names, one header | Keep one encrypted RUN_TIME value on API; match `SA360_ADMIN_API_KEY` or `ADMIN_API_KEY` on Admin C.O.C. |
| `NEXT_PUBLIC_SA360_API_BASE_URL` **and** `NEXT_PUBLIC_API_BASE_URL` | Legacy alias; first wins | Keep only `NEXT_PUBLIC_SA360_API_BASE_URL`. |

**Operator screenshot required:** env screens for both apps, app-level
and `sa360-api` / `sa360-admin-coc` component-level, names only.

### 9. API URL consistency across the two apps

Expected:

| App | Variable | Expected value |
| --- | --- | --- |
| `sa360-admin-coc` | `NEXT_PUBLIC_SA360_API_BASE_URL` | `https://sa360-sw6oq.ondigitalocean.app` (no trailing slash) |
| `sa360` / API | public URL | that same origin |
| `sa360` / worker | `SA360_API_INTERNAL_URL` if used | same origin or DO internal hostname |
| `sa360` / API | `GHL_OAUTH_REDIRECT_URI` | `https://sa360-sw6oq.ondigitalocean.app/integrations/oauth/callback` |
| `sa360` / API | `ADMIN_COC_BASE_URL` | `https://sa360-api-staging-coo57.ondigitalocean.app` |

The login bundle does not embed the API URL, so this check needs the
Admin C.O.C. env screen or an authenticated Fulfillment Ops load.

Mismatch symptoms: Admin C.O.C. health stays green while `/api/fulfillment-ops/*`
proxies 502 / wrong host. Confirm before the first live order.

### 10. Production debug routes and secret scope

**Finding — `ENABLE_DEBUG_ROUTES=true` is live on production API.**

| Route | Auth | Effect when flag is `true` |
| --- | --- | --- |
| `GET /debug/test-event` | none | Injects `POST /webhooks/ghl/lifecycle-event` with the server `WEBHOOK_SECRET`. Stores a synthetic lifecycle event for `lal_client_0142` / `LAL-DEBUG-0001`. |
| `GET /debug/logtail-test` | none | Writes one `logtail.test` line. |
| `GET` / `POST /webhooks/ghl/test` | none | `{ok:true,message:"Webhook test endpoint live"}`. |
| `GET /admin/v1/ghl/oauth/debug` | admin key | `401` without key (correct). |

README documents only `/debug/logtail-test`. The test-event route is a
write. This audit issued **one** `GET /debug/test-event` at
approximately `2026-10-14T16:07:53Z`. Response:
`statusCode=200`, `queued=false` (Meta dispatch not queued; event and
attribution were stored). Do not hit that URL again. Operator should
search webhook logs for `evt_debug_*` / `updated_by=debug_route` and
leave the synthetic row or delete it under a separate authorization.

**Recommended action (operator, not this agent):** unset
`ENABLE_DEBUG_ROUTES` on `sa360-api` RUN_TIME, redeploy or restart so
those routes return 404. Keep it off in production.

#### Variables that must stay encrypted RUN_TIME (never `NEXT_PUBLIC_`, never BUILD_TIME)

| Name | App / component |
| --- | --- |
| `DATABASE_URL` | `sa360` API, worker, migrate job |
| `REDIS_URL` | `sa360` API, worker |
| `WEBHOOK_SECRET` | `sa360-api` |
| `ADMIN_API_KEY` or `SA360_ADMIN_KEY` | `sa360-api` |
| `SA360_ADMIN_API_KEY` or `ADMIN_API_KEY` | `sa360-admin-coc` |
| `AGENT_WORKSPACE_API_KEY` or `SA360_WORKSPACE_SECRET` | `sa360-api` |
| `SA360_AGENT_WORKSPACE_API_KEY` or `AGENT_WORKSPACE_API_KEY` | `sa360-admin-coc` |
| `CLIENT_PORTAL_API_KEY`, `CLIENT_PORTAL_SESSION_SECRET` | API + Admin C.O.C. as documented |
| `ADMIN_COC_PASSWORD`, `ADMIN_COC_OBSERVER_PASSWORD`, `ADMIN_COC_SESSION_SECRET` | `sa360-admin-coc` only |
| `GHL_OAUTH_CLIENT_SECRET`, `GHL_TOKEN_ENCRYPTION_KEY`, `GHL_*_TOKEN` | `sa360-api` |
| `GOOGLE_OAUTH_CLIENT_SECRET`, `GOOGLE_TOKEN_ENCRYPTION_KEY` | `sa360-api` |
| `LOGTAIL_SOURCE_TOKEN` | API / worker |
| `META_*` tokens | API / worker |
| `SA360_LEADCAPTURE_WEBHOOK_SECRET`, `SA360_LEADCONDUIT_WEBHOOK_SECRET` | `sa360-api` |

#### Public / BUILD_TIME (no credentials)

| Name | Scope | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SA360_API_BASE_URL` | Admin C.O.C. BUILD_TIME **and** RUN_TIME | Public API origin only. Rebuild required if changed. |
| `NEXT_PUBLIC_SA360_BUILD_COMMIT_SHA` / `_SHORT` | Admin C.O.C. BUILD_TIME | `next.config.ts` already derives these from `SA360_BUILD_COMMIT_SHA`. Set `SA360_BUILD_COMMIT_SHA=${_self.COMMIT_HASH}` on the Admin C.O.C. component so the in-app deploy line is not `unknown`. |
| `NEXT_PUBLIC_SA360_ENV` | Admin C.O.C. BUILD_TIME | Badge only. |
| `SA360_BUILD_COMMIT_SHA` | API RUN_TIME | Already working. |

---

## Phase B — synthetic operator-review workflow

Local disposable logic only. The new first-controlled-order test plus the
existing #178 suite exercise the real service against an in-memory Prisma
stand-in (no production rows).

Command:

```text
cd apps/api && node --import tsx/esm --import ./src/test/set-test-env.ts --test \
  src/services/ppl-fulfillment/operator-review.service.test.ts \
  src/services/ppl-fulfillment/external-delivery-receipt.service.test.ts \
  src/services/fulfillment-ops/fulfillment-ops.service.test.ts \
  src/services/lead-inventory-review/lead-inventory-review-schema.test.ts
```

**Result: 59 pass / 0 fail.**

| Required behavior | Result |
| --- | --- |
| 3 purchased leads | Pass (`purchasedQuantity=3`) |
| +1 unbilled buffer | Pass (`bufferQuantity=1`, `capacityMode=unbilled_review`) |
| One structured rejection | Pass (`phone_quality`; generic `operator_rejected` rejected by existing test) |
| Replacement / shortfall reconciliation | Pass (unused buffer → shortfall 1 → one supplemental) |
| Accepted-only export | Pass (rejected allocation blocked; 3 accepted exportable) |
| Supplemental CSV | Pass (one accepted replacement identity; SHA-stable retry) |
| Idempotent retry | Pass (fill replay + reject replay keep original reason) |
| No unintended delivery recording | Pass (`BuyerDeliveredIdentity` write count 0) |
| No purchased-quantity increase | Pass (stays 3 after close) |
| No automatic billing | Pass (`billedQuantity=null`, `not_billed`) |
| No same-buyer duplicate identities | Pass (3 unique accepted allocation IDs) |
| Operator-review OFF path | Pass (`feature_disabled`; export gate remains open) |

Also re-confirmed: 100-purchased +2 buffer Alex path, 100/98/2
supplemental download, schema lock 84.

Admin C.O.C. Phase 3 workbench: **8 pass / 0 fail**. Stage 2e stays
hidden unless the operator-review flag is on. Stage 2f stays hidden
unless receipt import is on.

---

## Phase C — external receipt safety (synthetic only)

Same 59-test run includes `external-delivery-receipt.service.test.ts`.
No Vanessa workbook, no production import, import flag left default-off
except inside tests that opt in.

| Required behavior | Result |
| --- | --- |
| Historical applied receipts still suppress after import is disabled | Pass (`applied suppression survives import disable`) |
| Phone OR email match | Pass (same-phone/different-email, same-email/different-phone, phone-only, email-only) |
| Cross-batch duplicate grouping | Pass (two batches → one suppression set; other buyer empty) |
| Unmatched delivery evidence | Pass (unconfirmed unmatched not applied; confirmed unmatched + `sourceEvidence` applied; no `BuyerDeliveredIdentity`) |
| No `BuyerDeliveredIdentity` writes from receipt imports | Pass (`wroteBuyerDeliveredIdentity=false`) |
| No real Vanessa data import | Pass (synthetic 3260/44/3304 accounting only) |
| Fail-closed if suppression turned off while applied rows exist | Pass |
| Import stays off unless `=== "true"` | Pass (`"1"` does not enable) |

---

## Phase D — production Admin C.O.C. Fulfillment Ops

`/fulfillment-ops` redirects to login. No operator or observer password
is available to this agent. **No production order was opened, activated,
reserved, rejected, released, or delivered.**

**Operator screenshot required** after login, on a **non-customer** view
if possible (empty selection is enough):

1. Safety row: `LIVE DISABLED`, simulation-only copy, LF2 EXEC OFF,
   GHL CANARY OFF.
2. Flag-driven stages:
   - Stage 2e **visible** only if API bootstrap
     `SA360_PPL_OPERATOR_REVIEW_ENABLED=true`.
   - Stage 2f **hidden / Restricted** (`SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED`
     must stay false).
3. Deploy versions line (Admin vs API). API should read `2e2a9e1`. Admin
   may show `unknown` until `SA360_BUILD_COMMIT_SHA` is bound on the
   Admin C.O.C. component.
4. Do not click Open review batch, Fill shortfall, Close review, Preview
   receipts, or Apply receipts on a live buyer.

---

## Remaining production risks

1. **P0 — debug routes enabled.** Unauthenticated write on
   `/debug/test-event`. Unset `ENABLE_DEBUG_ROUTES` on `sa360-api`.
2. **P1 — feature-flag placement.** Operator-review `true` must be on
   `sa360-api`, not only Admin C.O.C. Receipt import must stay unset on
   the API. Unverified from this environment.
3. **P1 — production migrate job logs unseen.** API health does not prove
   the four new migrations applied. If they did not, first buyer
   selection fail-closes with `historical_delivery_suppression_unavailable`.
4. **P1 — Admin C.O.C. / worker revisions unseen.** Separate app; confirm
   Admin C.O.C. also deployed `2e2a9e1` so Stage 2e/2f UI matches the API.
5. **P2 — API URL split across two apps.** Confirm
   `NEXT_PUBLIC_SA360_API_BASE_URL` on `sa360-admin-coc` is the `sw6oq`
   API origin, not the `coo57` host and not a trailing-slash variant.
6. **P2 — one synthetic debug lifecycle event stored** during this audit
   (`queued=false`). Inspect; do not treat as a customer delivery.

---

## Alex — first controlled live order (exact steps)

Do this only after:

- [ ] `ENABLE_DEBUG_ROUTES` is unset and `/debug/test-event` returns 404
- [ ] Migrate job screenshot shows 84 applied, including the four names above
- [ ] API bootstrap flags: operator-review **true**, receipt import **false**,
      suppression **true**
- [ ] Admin C.O.C. Stage 2e visible, Stage 2f hidden, LIVE DISABLED
- [ ] Chosen order is a **small paid PPL order** (3 purchased is the
      rehearsed size). Not Vanessa. Not a production backfill.

### Choose the order

1. Admin C.O.C. → **Fulfillment Ops**.
2. Select one **active**, priced, pay-per-lead order with
   `requestedQuantity = 3` (or create that order through the normal
   priced path — do not use demo-order helpers in production).
3. Confirm the buyer has no open review batch and that you intend to
   deliver **exactly 3** purchased leads.

### Reserve, then open review (do not export yet)

4. Run the existing selection preview. Eligible must be ≥ 4 if you will
   take a +1 buffer (3 primary + 1 unbilled).
5. Commit selection for the **3 purchased** primaries only if that is
   still the current production commit step. Then Stage 2e → set
   **Buffer quantity = 1** → **Open review batch**.
6. Expect 4 rows: 3 `primary` + 1 `buffer`. `billedQuantity` stays empty.
   Purchased quantity stays 3.

### One structured rejection

7. Reject exactly one primary. Use a real code from the dropdown
   (`phone_quality`, `name_quality`, `placeholder_identity`, `duplicate`,
   `wrong_demographic`, `structurally_invalid`). Do not type a free-text
   reason. The lead must **release**, not mark delivered.
8. Accept the other two primaries.

### Shortfall and supplemental

9. Mark the leftover buffer **unused** (or close later so the batch marks
   unused buffers). Then **Fill shortfall**. Expect 1 unbilled
   supplemental reservation (`not_billed`).
10. Accept the supplemental. Purchased quantity must still be 3.
11. **Close review** with phrase `CLOSE REVIEW BATCH`. Do not check
    “Allow shortfall” if accepted already equals 3.
12. Download the supplemental CSV. It must contain **only** the newly
    accepted replacement identity.

### Accepted-only export

13. Run the buyer CSV export / commit **only for accepted allocations**.
    If a rejected allocation is included, the API must refuse with
    `operator_review_rejected_allocation`.
14. Confirm: no extra billing line, no purchased-quantity bump, no
    automatic `BuyerDeliveredIdentity` until the existing
    mark-spreadsheet-delivered step (which is a later, explicit action —
    skip it on this first test if you only need the export file).

### Stop conditions (abort, do not improvise)

- Receipt Stage 2f becomes visible → import flag leaked on; stop and unset
  `SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` on the API.
- Safety banner shows live delivery or LF2/GHL canary on → stop.
- Close or fill errors `historical_delivery_suppression_unavailable` →
  receipt tables or suppression load failed; do not disable suppression.
- Any retry creates a second open batch or a second supplemental set →
  stop and inspect `requestId` / idempotency keys.
- Buyer identity appears twice in the accepted export → stop; do not
  mark delivered.

### After the test

15. Record accepted / rejected / unused / shortfall counts.
16. Leave receipt import off. Do not import Vanessa sheets.
17. Only after this 3+1 order is clean, scale to the 100+2 rehearsal
    already covered in tests.

---

## Tests run

| Suite | Result |
| --- | --- |
| Operator-review + receipt + FO safety + schema lock | **59 / 59 pass** |
| Admin C.O.C. fulfillment-ops Phase 3 | **8 / 8 pass** |
| Local `prisma migrate deploy` (`sa360`, `sa360_test`) | 84 applied, second status check up to date |
| Production writes | none intended; one accidental debug lifecycle GET as noted |

## Migrations

None created. Local disposable DBs received the three #179 migrations
that the environment snapshot had not applied. Production was not
migrated from this agent.

## Follow-up dependencies

- Operator: debug-route unset, migrate-job screenshot, flag screenshot,
  Admin C.O.C. / worker revision screenshot, API URL screenshot.
- Auth/Account lane: none (schema already on master).
- Ingestion / Portal lanes: none.

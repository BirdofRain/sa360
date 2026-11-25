# SA360 production lead-delivery health audit

**System:** Smart Agent 360 / Life Agent Launch  
**Mode:** Read-only. No database writes, configuration changes, feature-flag changes, queue mutations, retries, webhook submissions, external deliveries, migrations, or deployments.  
**Code audited:** `b2fcd0369862b5e6ee20c53837a32b083eb8b5fe` (`b2fcd03`), which is `origin/master` and the active DigitalOcean revision for the API, worker, migrate job, and portal.  
**Audit clock:** 25 Nov 2026, about 9:26–9:40 AM America/New_York.  
**Evidence window that actually contains request logs:** 24 Nov 2026, 7:30 PM ET through 25 Nov 2026, 9:33 AM ET (container start `2026-11-25T00:30:02Z` through `2026-11-25T14:33:40Z`).  
**24-hour and 7-day database totals:** unavailable. See evidence gaps. Those periods are not reported as zero.

Labels used below:

- **Verified** — observed on the production app spec, a live HTTP response, a deployment record, or a retained container log.
- **Inference** — follows from verified logs plus the code at `b2fcd03`. Not a row-level database proof.
- **Unverified** — plausible, not demonstrated.
- **Unavailable** — access or retention does not cover it.

No consumer names, emails, phones, or payload bodies are included. Internal account ids and lead/run ids are.

---

## 1. Overall verdict: YELLOW

Production is up. The API, worker, and portal are on the current `master` commit. LeadCapture NextGen and one legacy LeadCapture route are accepting posts with HTTP 200. The Sheets drain is running every minute and completed 10 Google write attempts in this window. There is no evidence of a platform-wide outage in the retained logs (no API 5xx, no worker job exceptions).

The verdict is not green:

- The only GoHighLevel association deliveries logged in the window are for `jason_newman`: one `failed` run after `POST /opportunities/` returned HTTP 400, and two `partial_success` runs. Zero `succeeded` GHL association runs were logged. `partial_success` and a rejected GHL 4xx are held and are not replayed by the retry policy.
- The delivery-health monitor is off, so those outcomes do not page anyone.
- This environment cannot read production Postgres or Valkey. Independent source totals, per-client delivery ledgers, spreadsheet row proof, and BullMQ depth are unavailable. Missing rows must not be read as “zero missing leads.”
- The platform health check is `GET /health` only. That path does not check Postgres or Redis.

---

## 2. What was examined

| Source | Result |
| --- | --- |
| Repository at `b2fcd03` | Routes, flags, Prisma models, worker processors |
| DigitalOcean account `Smart Agent 360` (`sam@lifeagentlaunch.com`), read-only API | Apps, deployments, non-secret env, database cluster metadata, firewall, backups |
| `GET https://api.lifeagentlaunch.com/health`, `/health/db`, `/health/queue` | 200 at audit time. API commit `b2fcd03`, `buildSource` `SA360_BUILD_COMMIT_SHA` |
| `GET https://portal.lifeagentlaunch.com/api/health` and `/health` | 200, `service: admin-coc` |
| Same paths on the App Platform default hostnames | Same bodies as the custom domains |
| API and worker run logs for the active deployment | Full retained buffer since process start. Raw logs were aggregated and deleted. They were not committed. |
| Portal run log | 11 startup lines only (about 700 bytes). No request log. |
| TCP to `sa360-postgres` port 25060 and `sa360-valkey` port 25061 from this environment | Timed out. Firewall does not include this host. No firewall rule was added. |
| Datadog MCP | Discovery failed. Not used. |
| Google Sheets row reads and GHL contact reads | Not performed. No read credential was used to call Google or LeadConnector. |

Production `DATABASE_URL` and `ADMIN_API_KEY` are stored as DigitalOcean `SECRET` values and were not decrypted. Admin list endpoints were not called.

---

## 3. Architecture actually deployed

Three App Platform apps in `nyc`:

| App | Public URL | Role in this audit |
| --- | --- | --- |
| `sa360` (`2c381355-37a1-415f-bf06-ad477add164e`) | `https://api.lifeagentlaunch.com` (`https://sa360-sw6oq.ondigitalocean.app`) | API service `sa360-api`, worker `sa360-worker`, pre-deploy job `sa360-migrate` |
| `sa360-admin-coc` (`2075694a-ed30-4e7c-ae59-87b3ebfa9db7`) | `https://portal.lifeagentlaunch.com` (default host still named `sa360-api-staging-coo57`) | Next.js admin C.O.C. and customer portal. The hostname says staging. The env says `SA360_ENV=production`. |
| `goldfish-app` | `https://lifeagentlaunch.com` | Separate app. Not a SA360 delivery component. Not audited as a lead source. |

Data stores, both DigitalOcean managed, status `online`, region `nyc1`:

- Postgres 18 `sa360-postgres`, `db-s-1vcpu-1gb`, 10 GiB disk. Backup size on 24 Nov was about 3.39 GiB.
- Valkey 8 `sa360-valkey`, `db-s-1vcpu-1gb`. Latest backup 25 Nov 2026, 5:47 AM ET, about 13 MB.

Other clusters (`mysql`, `wordpress`, `sa360-vanessa-audit-20261012`) were not used. The Vanessa cluster is a separate Postgres from 12 Oct 2026 and is not the live primary.

### Lead sources and ingestion paths

Registered on the API at this commit. Traffic observed is only for the log window above.

| Path | Source | Production traffic in the log window | Enablement |
| --- | --- | --- | --- |
| `POST /sources/leadcapture/nextgen/lead-created` | LeadCapture NextGen | **Verified.** 97 posts, all HTTP 200 | Secret is set. Stage is `normalize_route_proof` |
| `POST /webhooks/leadcaptureio/:routeKey` | LeadCapture legacy | **Verified.** 30 posts, all HTTP 200, all on route key `LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX` | Legacy secret is set. No other legacy route key appeared |
| `POST /sources/zapier/facebook-lead` | Zapier Facebook capture | **Verified.** 4 posts, all HTTP 200 | Zapier webhook secret is set |
| `POST /webhooks/ghl/lifecycle-event` | GHL lifecycle (not a new lead form) | **Verified.** 14 posts, all HTTP 200 | `WEBHOOK_SECRET` is set |
| `POST /sources/facebook/lead-created`, `POST /webhooks/meta/leadgen` | Meta Lead Ads | **Verified absent** in this window | `SA360_META_LEAD_ADS_INTAKE_ENABLED`, `GRAPH_FETCH`, and `ROUTING` are all `false`. `META_SYNC_ENABLED=false` |
| `POST /sources/leadconduit/facebook-lead` | LeadConduit | **Verified absent** in this window | Secret is set. No traffic observed. Not proof the source is disabled |
| `POST /sources/google-sheet/lead-created` | Google Sheet intake | **Verified absent** | No traffic observed |
| `POST /voice/synthflow/inbound-lookup` | Synthflow | **Verified absent** | `SYNTHFLOW_INBOUND_ENABLED=false` on the API |
| Bulk CSV import | Operator upload | No bulk-import job log line after startup | `SA360_BULK_SOURCE_IMPORTS_ENABLED=true`. Worker concurrency 2. No job ran in this window |

NextGen stage order in code (`apps/api/src/services/source-intake/leadcapture-nextgen-stage.ts`):

1. `capture_only` — persist only
2. `inventory_only` — normalize, no routing
3. `normalize_route_proof` — **current production value** — normalize, exact campaign/form match, proof. Unmatched goes to review. This stage does not turn on live GHL or Sheets by itself.
4. `shadow_fulfillment` — shadow allocation, no live destination write
5. `live_canary` — one-lead canary, still separately gated

`docs/demo/leadcaptureio-webhook-setup.md` still says production is `inventory_only`. **Verified:** the deployed API value is `normalize_route_proof`. The doc is stale. Do not treat the doc as the runtime.

### Routing

- Inbound campaign match is `CampaignRoutingRule` (exact ids, then keyword fallback).
- `RoutingDryRunDecision` stores the decision. A dry-run row is not a destination write.
- Client GHL delivery is authorized only when the saved `ClientGhlDestination` has `deliveryEnabled`, `deliveryMode=live`, `clientCutoverApproved`, `internalApprovalStatus=approved`, and the location id matches (`isPersistedLiveDestination`). The direct-delivery env allowlist is not that switch.
- Company Sheets campaign dispatch is a separate switch on `CompanySheetsDestination.campaignDispatchEnabled` plus `campaignDispatchNotBefore`.
- `ClientCampaign*` rows are a request/shadow registry. Code comments say routing and legacy delivery do not read them.

### Delivery workers

`apps/worker/src/worker.ts` consumes BullMQ queues. On this boot the worker logged:

| Schedule | Enabled at boot | Interval |
| --- | --- | --- |
| `company-sheets-dispatch` | **Verified true** | 60s |
| `ghl-association-dispatch` | **Verified true** | 60s |
| `delivery-health-monitor` | **Verified false** (`action: noop`) | — |
| `external-webhook-delivery` | false | — |
| `external-webhook-notice` | false | — |
| `ghl-lead-notice` | false | — |
| `facets-supply-rebuild` | false | — |
| `consumer-age-birthday-sweep` | false | — |

The worker does not call Google itself. It `POST`s `/admin/v1/company-sheets/internal/process-dispatch` on the API. The API flag `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED=true` is what allows the append. GHL ongoing writes use `SA360_GHL_ONGOING_DELIVERY_ENABLED=true` inside a recorded association execution. Env ceiling `GHL_DELIVERY_ADAPTER_MODE` and `GHL_DELIVERY_ADAPTER_MAX_MODE` are both `live_canary`. The effective mode can also be lowered in `DeliveryRuntimeModeSetting`. That row was **unavailable**. A live `POST /opportunities/` during the window shows the effective mode allowed at least one external GHL write.

Sheets success in code is job status `succeeded` plus a `CompanySheetsDeliveryRow`. An HTTP 200 from the drain route is not that receipt. `executed: true` in the drain log means `executeCompanySheetsDeliveryJob` returned `ok`, which includes a succeeded append and also a finished non-success status that is then marked retryable. Duration of 2.3–3.5 seconds on those calls is **inference** that a Google round trip happened. It is not a spreadsheet row read.

GHL `partial_success` is held (`deliveryRetryDisposition` returns `hold`). A failed run whose steps include an HTTP 4xx is also held. The monitor will not replay them. That is intentional duplicate protection, and it also means a bad opportunity or workflow result sits until a person reviews it.

### Monitoring that exists

- App Platform alerts: `DEPLOYMENT_FAILED` and `DOMAIN_FAILED` only. No queue, delivery, or error-rate alert.
- API liveness: `GET /health` every 10 seconds, failure threshold 3. It does not touch Postgres or Valkey.
- Portal service: **no health check configured**.
- Logtail ingest host is set (`s2394892.eu-fsn-3-vec.betterstackdata.com`). The source token is a SECRET. This audit could not query Better Stack. Whether 7-day logs exist there is **unavailable**.
- `DeliveryHealthIncident` / `DeliveryHealthMonitorHeartbeat` exist in schema. The worker schedule is off, and `SA360_DELIVERY_HEALTH_MONITOR_ENABLED` is unset on the app. The runbook’s pilot (Ray Rodriguez) is not active in this deployment.

---

## 4. Infrastructure health

### Deployments — verified

Active `sa360` deployment `68980150-78a7-4107-b23c-28f06869150f`:

- Created 24 Nov 2026, 7:24 PM ET. Active by 7:30 PM ET.
- Cause: commit `b2fcd03` pushed to `master`.
- API, worker, and migrate job all built and deployed `SUCCESS` (12/12 steps).
- API and worker `source_commit_hash` are both `b2fcd0369862b5e6ee20c53837a32b083eb8b5fe`.

Portal deployment went active on the same commit at 24 Nov 2026, 7:29 PM ET.

Last 30 deployments of `sa360`: 1 active, 27 superseded, 2 canceled (20 Nov and 17 Nov). No `ERROR` phase in that page.  
Portal: one `ERROR` deploy at 24 Nov 2026, 3:11 PM ET for commit `b46738f` (Team Workspace styling). It did not become active. The previous deployment stayed up until `8979f0e` superseded it. **Inference:** that failure was a bad build, not a portal outage.

No version skew between API, worker, migrate, portal, and `origin/master`.

### Process health since that deploy — verified

| Process | Uptime at 9:33 AM ET | RSS | Event-loop p99 | Errors in log |
| --- | --- | --- | --- | --- |
| `sa360-api` | 50,583 s (about 14.1 h) | 264 MB → 296 MB | 21 ms | 1 warn, 0 error |
| `sa360-worker` | 50,582 s | 226 MB → 243 MB | 21 ms | 0 warn, 0 error |

Both are `apps-s-1vcpu-1gb`. Memory moved slowly. This is not a leak in this window. CPU percent is **unavailable** (monitoring API returned 403).

API request results in the window: **11,982 × HTTP 200** and **2 × HTTP 404** (`GET /`). No 5xx. The 404s were 25 Nov 2026, 12:37 AM ET.

`/health` was called about 10,141 times. `/health/db` 4 times, all 200. `/health/queue` 2 times, all 200. Some of those db/queue calls are this audit. **Do not read the liveness probe as continuous database health.**

### Postgres — partial

- **Verified:** cluster `online`, Postgres 18, one node, daily backups from 17 Nov through 24 Nov at 2:28 PM ET. Newest backup is not late; the next daily backup would fall after this audit.
- **Verified at audit time:** `GET /health/db` returned `{"ok":true,"db":"connected"}`.
- **Unavailable:** connections, locks, replication, bloat, slow queries, and every table count. Disk metrics API returned 403. Backup size 3.39 GiB on a 10 GiB volume is not pressure by itself.
- Firewall (verified): the `sa360` app, the portal app, and one IP (`162.238.211.81`). This audit host was not allowed.
- Users present: `doadmin`, `sa360_app`, `sa360_schema_owner`, `sa360_summary_operator`, `sa360_summary_reader`, `sa360_summary_runtime`. The API did not return passwords.

### Valkey / BullMQ — partial

- **Verified:** cluster `online`. `GET /health/queue` returned `PONG` at audit time. The worker completed 845 Sheets drain jobs and the API accepted 845 matching `POST`s, so Redis accepted BullMQ traffic for this process lifetime.
- **Verified:** no worker `failed` log line, and the Sheets drain never logged `http_error`, `timeout`, or `malformed_response`.
- **Unavailable:** queue depth, failed set, stalled set, and jobs older than this container. `removeOnFail: 40` on the Sheets repeatable job would also hide older failures. Valkey firewall allows the `sa360` app and one other IP (`242.176.102.135`). TCP from this host timed out.
- **Inference:** the two enabled repeatable jobs are healthy right now. That is not a 7-day queue audit.

---

## 5. Intake in the log window

Independent vendor totals (LeadCapture, Zapier, Meta) were not available. Reconciliation against those systems is **incomplete**, not “zero missing.”

### LeadCapture NextGen — verified application result

97 accepted events. Stage on every line: `normalize_route_proof`. HTTP 200 on every post. Zero duplicates logged. Zero validation-failure log lines (`invalid_payload` would have been HTTP 400; none occurred).

| Result | Count | Meaning |
| --- | --- | --- |
| `routing_matched` | 93 | Exact match persisted and routed |
| `routing_unmatched` | 4 | Persisted, no client. Review, not a crash |
| Duplicate | 0 | No replay of the same NextGen lead id in this window |
| HTTP non-200 | 0 | |

Hourly accepted posts (UTC hour start, 25 Nov): 00h 9, 01h 17, 02h 7, 03h 12, 04h 13, 05h 7, 06h 2, 07h 5, 08h 3, 09h 4, 10h 3, 11h 2, 12h 6, 13h 5, 14h 2. Traffic did not stop overnight.

The captured log does **not** include `clientAccountId`. Per-client NextGen counts are **unavailable**.

Unmatched source lead ids (investigate; not failures of the HTTP handler):

| Source lead id | Received (ET) |
| --- | --- |
| `cmwvfnw19006ohn0uwvu5rc7d` | 24 Nov, 8:16 PM |
| `cmwvhfwiz00d6hn0ulbzqzjjo` | 24 Nov, 9:06 PM |
| `cmwvmz3b100v2hn0utp7t35pe` | 24 Nov, 11:41 PM |
| `cmww4r2q801f5hn0uyo0c97pd` | 25 Nov, 7:59 AM |

### LeadCapture legacy — verified HTTP, incomplete event breakdown

30 `POST /webhooks/leadcaptureio/LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX`, all HTTP 200. The handler returns 200 only after `processImpl` returns and the webhook log is completed, so these were accepted rather than rejected. The legacy route does not emit the NextGen captured line, so duplicate versus new, matched versus unmatched, and client id are **unavailable** from logs. No `legacy_paused_for_nextgen` warning and no `leadcapture.failed` error.

### Zapier Facebook — verified HTTP only

4 posts, all HTTP 200 (about 9 PM, 10 PM, and midnight ET on 24 Nov, and 9 AM ET on 25 Nov). Persist and routing outcome **unavailable** from this log line.

### What did not arrive

No Meta Lead Ads, LeadConduit, Google Sheet source, Synthflow, or bulk-import job in the window. Meta native intake is **configured off**. The others are “no traffic observed,” not a proof of disablement.

### GHL lifecycle dry-runs — verified, and they are not lead-form intake

14 lifecycle webhooks, 12 routing dry-runs, all `delivery_mode=dry_run` for master `lal_master_vet`:

- 8 unmatched (`confidence: none`, no destination)
- 4 matched to `smart_agent_360_demo_2`

Two lifecycle posts did not run a dry-run (`shouldRunRoutingDryRun` is false for some event names). These rows do not by themselves create Sheets or GHL lead deliveries. Matched demo decisions stayed `dry_run`.

---

## 6. Routing and delivery in the log window

| Step | 24h | 7d | Log window (14.1 h) | Class |
| --- | --- | --- | --- | --- |
| NextGen posts accepted | Unavailable (missing ~10 h before this container) | Unavailable | 97 | Verified |
| NextGen matched / unmatched / duplicate | Unavailable | Unavailable | 93 / 4 / 0 | Verified |
| Legacy LeadCapture accepted | Unavailable | Unavailable | 30 | Verified HTTP; event split unavailable |
| Zapier Facebook accepted | Unavailable | Unavailable | 4 | Verified HTTP |
| Sheets drain ticks | Unavailable | Unavailable | 845, all `outcome=completed` | Verified |
| Sheets intents processed / executor `ok` | Unavailable | Unavailable | 11 / 10 | Verified counters. Row proof unavailable |
| Sheets deferred | — | — | 0 | Verified |
| GHL association runs recorded | Unavailable | Unavailable | 3 (0 succeeded, 2 partial, 1 failed) | Verified |
| Leads awaiting manual review | Unavailable | Unavailable | At least the 4 unmatched NextGen ids | Incomplete |
| Portal versus admin delivery badge | Unavailable | Unavailable | Unavailable | No portal request log and no database |

### Sheets drain — verified counters

845 one-minute drains from 7:31 PM ET 24 Nov through 9:33 AM ET 25 Nov. Median duration 69 ms (empty queue). p95 300 ms. Max 3,541 ms.

Eleven drains processed an intent. Ten returned executor `ok`. None deferred. Stop reason was empty on all of them (the field is null when the loop finishes because the queue is empty, not because of an error).

| Time (ET) | Processed | Executor ok | Duration |
| --- | --- | --- | --- |
| 24 Nov, 8:01 PM | 1 | 1 | 2.8 s |
| 24 Nov, 8:26 PM | 1 | 1 | 2.6 s |
| 24 Nov, 8:31 PM | 1 | 1 | 2.3 s |
| 24 Nov, 10:42 PM | 1 | 1 | 3.0 s |
| 24 Nov, 11:30 PM | 1 | 1 | 2.5 s |
| 24 Nov, 11:59 PM | 1 | 1 | 2.5 s |
| 25 Nov, 2:30 AM | 1 | 1 | 3.5 s |
| 25 Nov, 3:01 AM | 1 | **0** | 3.3 s |
| 25 Nov, 3:02 AM | 1 | 1 | 2.3 s |
| 25 Nov, 4:00 AM | 1 | 1 | 3.0 s |
| 25 Nov, 4:58 AM | 1 | 1 | 2.8 s |

**Inference:** a ~2–3.5 s executor-ok result is a Google call that returned `ok` from `executeCompanySheetsDeliveryJob`. That is stronger than the drain’s HTTP 200, and weaker than a read of the spreadsheet. One intent at 3:01 AM ET was processed and not counted `executed`, then a second intent was executor-ok at 3:02 AM. The same source lead id was logged both minutes (below). No error line was emitted for the first attempt.

`company_sheets.lead_type_diagnostic` fired with `campaign_lead_type_unresolved` and the write path still ran:

| Source lead id | When (ET) | Note |
| --- | --- | --- |
| `cmwvmjhik00sxhn0uem8jjfz9` | 24 Nov, 11:30 PM | Diagnostic during an executor-ok drain |
| `cmwvnkwqn00wchn0u9i2wj6o8` | 24 Nov, 11:59 PM | Same |
| `cmwvu2j000145hn0ujf4367hk` | 25 Nov, 3:01 AM and 3:02 AM | First drain not executor-ok; second was |

**Inference:** lead-type unresolved did not block the append. Age/DOB completeness was not in this log line. Whether the sheet cell is blank is **unavailable**.

93 NextGen matches versus 10 Sheets executions is **not** by itself a delivery bug. `normalize_route_proof` does not arm Sheets. Only clients with campaign dispatch enabled and an intent due after `campaignDispatchNotBefore` are drained. Which clients those 10 were is **unavailable** (the drain log has counts, not client ids).

### GoHighLevel — verified attempts, not clean completions

All three recorded association executions are client `jason_newman`. The service flag is on, and these calls left SA360.

| When (ET) | Source lead id | Run id | Recorded status | Adjacent evidence |
| --- | --- | --- | --- | --- |
| 24 Nov, 10:01 PM | `cmwvjeql600i4hn0ugkcur9k9` | `cmwvjeutx00iohn0u95v1d578` | `failed` | 300 ms earlier, `ghl_live_canary` / `ghl_request_failed`, `POST /opportunities/` HTTP 400. The warn line does not repeat the lead id. **Inference:** it is the same attempt. |
| 24 Nov, 10:41 PM | `cmwvktviw00nhhn0uc3ru5eer` | `cmwvktzdk00o3hn0ug0dl3b2x` | `partial_success` | No second `ghl_request_failed` in the window |
| 25 Nov, 4:57 AM | `cmwvy9fwa017lhn0uxyly0cq6` | `cmwvy9koo0187hn0ucj8mmu1u` | `partial_success` | Same |

Code, not a guess: `partial_success` is used when a contact write can succeed while workflow start, opportunity, owner, or custom-field stamping does not fully succeed. `hold` means the next association drain will not send those operations again.

**Unavailable, and required before calling the contact “delivered”:** GHL contact id, workflow enrollment id, which step failed on the two partial runs, and whether the opportunity 400 was validation (missing field) or a bad pipeline id. This audit did not call LeadConnector.

No other client logged `association_ghl.recorded`. That means either no other client is activated for ongoing GHL, or their runs were not reached. Both are possible. It is not evidence that every other client is healthy.

### Intentional non-delivery — do not treat as outages

- NextGen stage is below `live_canary`.
- Delivery-health, external webhook, and GHL SMS notice schedules are off.
- Meta Lead Ads intake flags are false.
- Lifecycle matches to `smart_agent_360_demo_2` stayed `dry_run`.
- Direct-delivery allowlist (`smart_agent_360_demo_2`, `vet_life_james_torrey`, `alex_gross`) is the legacy/demo canary list. Cutover code says not to use it to turn on association GHL or Sheets.

Paused, capture-only, and held inventory could not be counted. Those rows are in Postgres.

---

## 7. Destination verification

### Google Sheets

| Check | Result |
| --- | --- |
| Company OAuth flag | **Verified** `SA360_COMPANY_GOOGLE_OAUTH_ENABLED=true` and `SA360_COMPANY_GOOGLE_SHEETS_ENABLED=true` |
| Dispatch / execution flags | **Verified** both `true` on the API. Worker dispatch flag `true` |
| Approved Drive folder env | Set. Not repeated here |
| `CompanyGoogleConnection.status` | **Unavailable** |
| Per-client spreadsheet id, worksheet id, published header map | **Unavailable** |
| OAuth token expiry / reconnect | **Unavailable** in the database. No `google_reconnect_required` or `access_denied` log line in the window |
| Write attempts | **Verified** 11 processed, 10 executor-ok |
| Google API response body | **Unavailable** (not logged at info) |
| Durable `CompanySheetsDeliveryRow` | **Unavailable** |
| Duplicate protection | **Verified in code:** `stableRowId` is unique per worksheet; retries are not a second logical row. Not re-checked against a live sheet |
| Delivered without proof | Cannot certify. Do not mark the 10 executor-ok drains as customer-visible deliveries until `CompanySheetsDeliveryJob.status=succeeded`, `finishedAt`, and a written row exist |

### GoHighLevel

| Check | Result |
| --- | --- |
| OAuth client id / redirect | Set. Redirect is `https://sa360-sw6oq.ondigitalocean.app/integrations/oauth/callback`. Company Google redirect uses `https://api.lifeagentlaunch.com`. GHL still uses the default App Platform host. **Verified config.** Not shown to be broken |
| Ongoing flag and adapter ceiling | **Verified** service on, max mode `live_canary` |
| Which subaccounts are activated | **Unavailable** except that `jason_newman` received live calls |
| Contact create vs workflow enroll | **Not separated in the log.** `partial_success` explicitly does not mean both succeeded |
| Opportunity 400 | **Verified** one HTTP 400. Body not logged. Root cause of the 400 is **unavailable** |
| Duplicate contact risk | **Unverified.** Hold-on-partial reduces a blind retry. It does not prove the first contact write was unique |
| Workflow required? | Per destination (`workflowStartRequired`). **Unavailable** for `jason_newman` |

---

## 8. Leads and jobs to investigate

Do not replay these from this report. The retry policy is holding them on purpose. Confirm the stored step rows first.

1. `sourceLeadEventId=cmwvjeql600i4hn0ugkcur9k9`, `GhlLiveDeliveryRun=cmwvjeutx00iohn0u95v1d578`, client `jason_newman`, 24 Nov 2026 10:01 PM ET. Run status `failed`. Adjacent `POST /opportunities/` HTTP 400.
2. `cmwvktviw00nhhn0uc3ru5eer` / run `cmwvktzdk00o3hn0ug0dl3b2x`, `jason_newman`, 24 Nov 2026 10:41 PM ET, `partial_success`.
3. `cmwvy9fwa017lhn0uxyly0cq6` / run `cmwvy9koo0187hn0ucj8mmu1u`, `jason_newman`, 25 Nov 2026 4:57 AM ET, `partial_success`.
4. Sheets lead-type unresolved: `cmwvmjhik00sxhn0uem8jjfz9`, `cmwvnkwqn00wchn0u9i2wj6o8`, `cmwvu2j000145hn0ujf4367hk`. The third also had a non-executed drain one minute before an executor-ok drain.
5. NextGen unmatched: the four ids in section 5. They are expected review rows for this stage, and they still need a human to confirm the campaign is supposed to match.

No BullMQ job id was logged as failed. The Sheets repeatable job id is the schedule id, not a stuck lead.

---

## 9. Per client / campaign

A full client roster was not readable.

| Client / route | What is verified in the window | What is not |
| --- | --- | --- |
| `jason_newman` | 3 live GHL association attempts: failed, partial, partial. No succeeded run | Whether the contact exists, whether the workflow enrolled, whether Sheets also ran |
| `smart_agent_360_demo_2` | 4 lifecycle dry-runs matched, `delivery_mode=dry_run` | Not a live delivery result |
| `lal_master_vet` | Master account on those lifecycle dry-runs. 8 unmatched | Not a buyer destination |
| Legacy route `LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX` | 30 HTTP 200 | Client id, duplicates, downstream delivery |
| NextGen matched leads (93) | Accepted and `routing_matched` | Which client, which destination, whether an intent exists |
| Everyone else | — | Active, paused, capture-only, or unwired. **Unavailable** |

Portal Delivered versus admin delivery status: **unavailable**. The portal container log does not record page requests. The current commit (`b2fcd03`) only changes Delivered-tab paging. It does not change GHL or Sheets write behavior.

---

## 10. Critical issues

### 1. GHL deliveries for `jason_newman` are not completing — severity high — verified outcome, unverified vendor cause

Evidence: three `association_ghl.recorded` lines and one `ghl_request_failed` in the API log, 24 Nov 10:01 PM ET through 25 Nov 4:57 AM ET. Component: `association-ongoing-delivery` and `ghl-live-canary-executor`. A 400 on `/opportunities/` is a rejected GHL response. `partial_success` is held, so the missing step will not retry by itself.

Fix path (after review, not in this change): read `GhlLiveDeliveryStepRun` for those three run ids. Separate contact acceptance, opportunity 400 body, and workflow result. Correct the pipeline/stage or required field. Do not press a manual replay until the stored receipt says the contact write did not already happen.

### 2. Delivery health monitor is off — severity high — verified

Worker boot log `delivery_health.schedule` `enabled: false` `action: noop`. The flag is unset. App alerts do not cover failed deliveries. The GHL failure above produced one warn line and no page.

Component: `apps/worker` schedule and `POST /admin/v1/delivery-health/internal/scan`. Follow `docs/runbooks/delivery-health-monitoring.md`. That monitor writes incident rows; turning it on is an operational change and was not done here.

### 3. Production reconciliation cannot be finished from this network — severity high for the audit, not a customer outage — verified

Postgres and Valkey trusted sources do not include an audit host. `sa360_summary_reader` exists and the API would not reveal its password. 7-day counts and spreadsheet proof need that role, or a Better Stack query token. Do not open the firewall to a shared cloud agent as a standing rule; use a short-lived, read-only path if a human approves it.

### 4. Plaintext secrets in the App Platform spec — severity high — verified, values omitted

Several credentials on `sa360` and `sa360-admin-coc` are ordinary env vars, not DigitalOcean `SECRET` type. This audit saw plaintext for a GHL private integration token, the GHL OAuth client secret, the Resend API key, portal/admin passwords, and session secrets. They are not copied into this report. Anyone who can read the app spec can read them.

Rotate those credentials and store the replacements as `SECRET`. `ENABLE_DEBUG_ROUTES=true` on the portal app should be reviewed; the API correctly has it `false`.

### 5. Four NextGen leads unmatched — severity medium — verified

Ids in section 5. This is the designed `normalize_route_proof` outcome (no fallback client). Still a routing gap if those funnels were supposed to be live.

### 6. Sheets lead type unresolved on three writes — severity medium — verified diagnostic, unavailable cell proof

`campaign_lead_type_unresolved` did not stop the executor. If the published map requires lead type, Age, or DOB, those columns may be blank while the job still looks successful. Confirm on the three source lead ids before telling the client the row is complete.

### 7. Health checks do not see the dependency that delivery needs — severity medium — verified

API probe path is `/health`. Portal has no probe. `/health/db` and `/health/queue` were almost unused. A stuck worker or a refused database can coexist with a green deployment.

### 8. Log retention does not cover 24 hours on the platform log API — severity medium — verified

`historic_urls` was empty. The run log is the current container since 7:30 PM ET 24 Nov. The previous 10 hours of the “last 24 hours,” and the six days before that, are not in this buffer. Better Stack may have them. This audit could not query it.

---

## 11. Root causes that are actually demonstrated

| Finding | Cause | Confidence |
| --- | --- | --- |
| API/worker/portal report `b2fcd03` | That commit was deployed and is `master` | Verified |
| NextGen leads route but most do not fan out to GHL/Sheets | Stage `normalize_route_proof` plus per-client destination switches | Verified config and code. Per-client switch state unavailable |
| `jason_newman` run `cmwvjeutx00iohn0u95v1d578` is `failed` | GHL `POST /opportunities/` returned 400 during that attempt | Verified HTTP status. The 400 response body was not logged |
| Those runs will not retry themselves | `deliveryRetryDisposition` returns `hold` for `failed`+rejected 4xx and for `partial_success` | Verified in code. Applies if the stored steps match that shape |
| No delivery page fired | Monitor schedule removed/not registered because the flag is off | Verified |
| This report has no 7-day SQL counts | Firewall drop plus no decrypted read-only URL | Verified |

Not demonstrated: a bad deploy, a down database, a stalled BullMQ queue, a broken company Google token, or a portal/admin status mismatch.

---

## 12. Recommended next actions

Do not implement these until this report is reviewed.

1. **Auth/Account or the operator with database access**, read-only, statement timeout 15s, indexed on `receivedAt` / `createdAt` / `startedAt`. Run the queries in the appendix for the last 24 hours and 7 days. Publish counts only.
2. **GHL delivery owner**, open the three `jason_newman` run ids. Record contact id, opportunity error, and workflow step without copying the lead payload into Slack. Fix the destination field or pipeline. Resume only the steps the receipt says did not complete.
3. **Operator**, after the queries look right, enable the delivery-health monitor for one client id using the existing runbook. Leave notify off for the first dry run.
4. **Whoever holds the DigitalOcean spec**, rotate the plaintext secrets and set type `SECRET`.
5. **Ingestion**, identify the four unmatched NextGen leads by id (campaign/form only) and either add the exact routing rule or confirm they should stay in review.
6. **Sheets**, for the three diagnostic lead ids, compare the stored job status and `CompanySheetsDeliveryRow` to the sheet. Do not replay an executor-ok job.
7. **Platform**, point a second check at `/health/db` and `/health/queue`, and alert if the worker stops logging `company_sheets_dispatch.drain` for 3 minutes while the flag is on.

### Suggested alert thresholds

| Signal | Warn | Page |
| --- | --- | --- |
| `association_ghl.recorded` status `failed`, or `ghl_request_failed` | — | Immediately |
| `partial_success` with workflow required and workflow not started | — | Immediately |
| `partial_success` with workflow not required | Within 15 minutes | If still open at 1 hour |
| Sheets drain log missing while dispatch flag is true | 3 minutes | 10 minutes |
| Sheets intent `uncertain` or executor not ok | 1 event | 2 in 15 minutes, or any `uncertain` |
| NextGen HTTP non-200 | 1 | 3 in 15 minutes |
| NextGen `routing_unmatched` | 5 in 1 hour | 15 in 1 hour |
| `/health/db` or `/health/queue` not 200 | — | 2 consecutive |
| Worker uptime reset outside a deploy | Note | If a second restart happens within 15 minutes |
| BullMQ `wait` + `delayed` for `company-sheets-dispatch` or `ghl-association-dispatch` | > 20 for 5 minutes | > 100 or any `stalled` |
| Delivery-health heartbeat `lastSucceededAt` once the monitor is on | 5 minutes stale | 15 minutes, or `consecutiveFailures >= 3` |

---

## 13. Safe reproduction

These were **not** executed. They are the bounded reads a `sa360_summary_reader` session should run, with `default_transaction_read_only=on` and `statement_timeout=15s`. They use the indexed time columns. They do not select payload JSON, email, or phone.

```sql
-- Window bounds
-- last 24h: now() - interval '24 hours'
-- last 7d:  now() - interval '7 days'

SELECT "sourceProvider", "sourceSystem", status, count(*)
FROM "SourceLeadEvent"
WHERE "receivedAt" >= now() - interval '24 hours'
GROUP BY 1, 2, 3
ORDER BY 1, 2, 3;

SELECT "processingStatus", count(*)
FROM "WebhookRequestLog"
WHERE "receivedAt" >= now() - interval '24 hours'
GROUP BY 1;

SELECT status, count(*)
FROM "CompanySheetsDispatchIntent"
WHERE "createdAt" >= now() - interval '24 hours'
GROUP BY 1;

SELECT status, count(*)
FROM "CompanySheetsDeliveryJob"
WHERE "createdAt" >= now() - interval '24 hours'
GROUP BY 1;

SELECT "clientAccountId", status, count(*)
FROM "GhlLiveDeliveryRun"
WHERE "startedAt" >= now() - interval '24 hours'
GROUP BY 1, 2;

SELECT id, "lastSucceededAt", "lastFailedAt", "consecutiveFailures"
FROM "DeliveryHealthMonitorHeartbeat";

SELECT "clientAccountId", "failureClass", severity, status, "affectedCount", "lastSeenAt"
FROM "DeliveryHealthIncident"
WHERE status = 'open';
```

Repeat the grouped counts with `7 days`. Join delivery failures back to `sourceLeadEventId` only after the aggregates look sane. Do not `SELECT rawPayloadJson`.

Log method used here: DigitalOcean `GET /v2/apps/{id}/deployments/{id}/logs?type=RUN`, then count JSON `message` fields. That buffer starts at process boot. It is not a 7-day store.

---

## 14. Evidence class rollup

| Claim | Class |
| --- | --- |
| Services are on `b2fcd03` and answering HTTP 200 | Verified |
| Postgres and Valkey answered one health check each | Verified spot check |
| Postgres backups are daily through 24 Nov 2:28 PM ET | Verified |
| Worker Sheets and GHL drains ran every minute since 7:30 PM ET 24 Nov | Verified |
| 97 NextGen leads, 93 matched, 4 unmatched, 0 duplicates in that window | Verified |
| 10 Sheets executor-ok attempts | Verified counter. Sheet rows unavailable |
| `jason_newman` GHL: 1 failed, 2 partial, 0 succeeded | Verified |
| Opportunity error is HTTP 400 | Verified. Body unavailable |
| Those GHL runs will not auto-retry | Inference from code, if stored steps match the policy |
| No leads were lost versus LeadCapture or Zapier | **Unavailable.** Do not report zero loss |
| 24-hour and 7-day totals | **Unavailable** |
| Queue depth, stalled jobs, portal/admin disagreement | **Unavailable** |
| Company Google token is healthy for every client | **Unverified.** The 10 slow executor-ok calls only suggest it worked for those writes |

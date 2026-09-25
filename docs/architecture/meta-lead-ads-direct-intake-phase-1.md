# Meta Lead Ads direct intake — Phase 1 audit and implementation design

**Status:** design only. No product-code, schema, or production-config changes in this document’s accompanying PR.  
**Base:** `origin/master` at `ee4963f` (`feat: add aged order options to customer portal (#139)`).  
**Lane:** Ingestion (webhooks, source adapters, normalization, routing). Schema/migration work, if later approved, is Auth/Account. Admin C.O.C. filter polish is Quality.

---

## Executive finding

SA360 already has a **Facebook / Meta Lead Ads intake pipeline**. Phase 1 is not a greenfield adapter. It is a **hardening, rename/alias, ownership, and safety-gate** job on the existing seam, plus a **public webhook path** Meta can subscribe to.

The most important current-state risk is **not** accidental GHL delivery. Facebook intake never calls the GHL adapter. The most important risk **is** `trackCampaignInventorySafely({ sourceLane: "meta_lead_ads" })`, which can create a commercially usable `LeadInventoryItem` (`inventoryClass: "aged"`, `exclusivityMode: "configurable"`, status possibly `available`) **without stamping `originClientAccountId`**. PPL selection excludes an origin client from buying *its own* inventory only when origin is stamped; a null origin stays eligible for other buyers after age holds expire.

**Phase 1 must stop Meta campaign leads from entering the PPL / aged-resale supply path unless an explicit ownership policy later says otherwise.**

Desired Phase 1 safety state:

| Gate | Required Phase 1 value |
| --- | --- |
| Meta intake feature flag | disabled by default |
| GHL live delivery | disabled (existing ceilings unchanged) |
| Meta CAPI / return dispatch | disabled (`send_to_meta: false`; `meta.dispatch_mode` stays `disabled`/`simulate`) |
| Legacy Facebook → Zapier / LeadConnector / GHL | unchanged (`POST /webhooks/ghl/lifecycle-event` and vendor webhooks) |
| Meta routing | shadow / dry-run only |
| Unmatched sources | review (`routing_unmatched` + `routing_review_required`) |
| Resale / PPL eligibility | none unless an explicit ownership policy is later authorized |

---

## A. Current architecture findings

### A.1 Intake lanes that already exist

There are **three Facebook-adjacent intake paths** plus the GHL lifecycle webhook that production uses today for Zapier/LeadConnector-delivered Facebook leads.

| Path | HTTP | Adapter | What it does today |
| --- | --- | --- | --- |
| **Direct Meta Lead Ads (this work)** | `GET/POST /sources/facebook/lead-created`, `POST /sources/facebook/test-lead` | `facebook` / `meta_lead_ads` | HMAC verify, optional Graph fetch, `SourceLeadEvent`, dry-run routing, **campaign inventory tracking** |
| **LeadConduit Facebook (vendor)** | `POST /sources/leadconduit/facebook-lead` | `facebook` / `external_vendor`, lane `leadconduit_facebook` | Header/basic auth, replay-by-`sourceLeadUid`, dry-run routing, **no** campaign inventory tracking |
| **LeadCapture.io legacy** | `POST /webhooks/leadcaptureio` | `leadcapture_io` / `leadcapture_io_legacy` | Shared normalizer + dry-run + campaign inventory (`sourceLane: "leadcapture_io"`) |
| **LeadCapture NextGen** | `POST /sources/leadcapture/nextgen/lead-created` | `leadcapture_io` / `leadcapture_io_nextgen` | Staged (`capture_only` → `inventory_only` → `normalize_route_proof` → `shadow_fulfillment` → `live_canary`), idempotent replay, SourceFunnel origin |
| **GHL lifecycle (production CRM events)** | `POST /webhooks/ghl/lifecycle-event` | N/A (already-normalized MASTER 2.0) | Auth `x-sa360-secret`, persist `LifecycleEvent` + `LeadAttribution` + `InboundContactIndex`, optional Meta CAPI enqueue, optional routing dry-run on `lead_created` |

`SOURCE_LEAD_NORMALIZERS` in `source-lead-normalizer.registry.ts` currently registers **only** LeadCapture.io. Facebook is **not** in that registry. Direct Meta intake is a dedicated service (`facebook-lead-intake.service.ts` + `facebook-lead-normalizer.ts` + `meta-lead-graph.service.ts`), which is the correct pattern: do not force Meta through the LeadCapture normalizer.

### A.2 Direct Meta pipeline (as implemented)

```
Meta GET hub.challenge
  → verifyMetaWebhookChallenge(META_WEBHOOK_VERIFY_TOKEN)
  → 200 text/plain challenge  |  403
  → NOT written to WebhookRequestLog today

Meta POST leadgen notification
  → startLog(source=facebook_lead_ads, route=/sources/facebook/lead-created)
  → validateMetaSignature(X-Hub-Signature-256, rawBody, META_APP_SECRET)
       production + missing secret → 503 fail-closed
       non-prod + missing secret → skip
       bad signature → 401
  → extractLeadgenEnvelopes(entry[].changes[field=leadgen])
  → if FACEBOOK_DIRECT_INTAKE_ENABLED != true:
       persist SourceLeadEvent(status=received, raw envelope only)
       skip Graph, skip routing, skip inventory
  → if enabled:
       SYNCHRONOUS Graph GET /{leadgenId}?fields=...
       mapMetaLeadToFacebookFields
       processFacebookSourceLead:
         create SourceLeadEvent
         normalize → lifecycleEventSchema
         persistRoutingAndDuplicate (runRoutingDryRun only)
         trackCampaignInventorySafely(sourceLane=meta_lead_ads)   ← commerce hazard
  → always HTTP 200 after auth (invalid JSON / no leadgen still 200)
```

Registered in `apps/api/src/app.ts` via `sourcesFacebookRoutes`. Kill switch: `FACEBOOK_DIRECT_INTAKE_ENABLED` defaults **false**.

### A.3 What “canonical” already means

- **Intake event:** `SourceLeadEvent` (raw + normalized JSON, routing result, duplicate risk, enrichment metadata).
- **Normalized contract:** MASTER 2.0 `LifecycleEventSchema` (`apps/api/src/schemas/lifecycle-event.schema.ts`).
- **Routing registry:** `CampaignRoutingRule` matched by `campaign_id` / `adset_id` / `ad_id` / `form_id_utm_campaign` / `utm_campaign` / `keyword_fallback`.
- **Shadow routing record:** `RoutingDryRunDecision` + lifecycle events `lead_matched` + `lead_routed_dry_run` or `routing_review_required`.
- **Attribution snapshot (CRM, not intake):** `LeadAttribution` keyed by `leadUid`. Written by the GHL lifecycle webhook and Google Sheet intake; **not** by Facebook intake today.
- **Voice/workspace index:** `InboundContactIndex`. Written by GHL lifecycle ingest; **not** by Facebook intake today.
- **Proof/evidence:** `LeadProof` + `LeadProofArtifact` (`provider: meta_lead_ads`). Facebook dry-run persist *does* call `persistLeadProofFromPayload`.
- **Supply / commerce:** `InventoryLot` + `LeadInventoryItem` (separate domain). Facebook intake currently writes this via campaign tracking.
- **Origin ownership for inventory:** `SourceFunnel.originClientAccountId` (LeadCapture NextGen) → `LeadInventoryItem.originClientAccountId`. Facebook origin is **not** stamped.

### A.4 Idempotency today

| Lane | Replay key | Unique DB constraint? | Behavior on retry |
| --- | --- | --- | --- |
| LeadCapture NextGen | `(provider, system, sourceLeadId)` via `findCorrelatedSourceLeadEvents` | Index only, **not unique** | Returns existing event if already normalized |
| LeadConduit Facebook | `sourceLeadUid` (`leadconduit-facebook-{leadgen\|delivery\|id}`) | No unique | Merge replay payload; skip re-route if terminal |
| Direct Facebook | none | Index `(sourceProvider, sourceSystem, sourceLeadId)` only | **Creates a new `SourceLeadEvent` every POST** |
| GHL lifecycle | `LifecycleEvent.eventUuid` unique | Yes | Duplicate UUID short-circuits |

Meta retries the same `leadgen_id` notification. Direct Facebook intake will duplicate rows unless Phase 1 adds replay (application-level first; unique constraint later).

Duplicate *risk* after create (`evaluateSourceLeadDuplicateRisk`) can mark a later row `duplicate_blocked`. That is a review signal, not webhook idempotency.

### A.5 Graph fetch today

`fetchMetaLeadDetails` runs **inside the POST handler** when intake is enabled. Token is query-string only (`META_PAGE_ACCESS_TOKEN`), never logged. There is **no BullMQ job** for Graph retrieval. Existing queues:

- `meta-dispatch` — **outbound CAPI**, do not reuse.
- `bulk-import-delivery`, `fulfillment-shadow`, `facets-supply-rebuild` — unrelated.

### A.6 Routing and delivery today

`persistRoutingAndDuplicate` always uses `runRoutingDryRun`:

- Loads active `CampaignRoutingRule`s for `payload.client_account_id` (the **master** account, `SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID`).
- Matcher reads `attribution.campaign_id/adset_id/ad_id`, `routing.form_id`, UTMs, `source_platform` / `source_type`.
- Unmatched → `SourceLeadEvent.status = routing_unmatched`, lifecycle `routing_review_required`.
- Matched → `routing_matched`, lifecycle `lead_matched` + `lead_routed_dry_run`.
- Emitted routing events force `send_to_meta: false` and `delivery_mode: dry_run`.
- **Does not** create GHL contacts, opportunities, workflows, `DeliveryInstruction`s, or LF2 outbox rows.
- **Does** persist `LeadProof` (non-blocking).

Live GHL only happens later via `approveSourceLeadDelivery` (`APPROVE SOURCE LEAD DELIVERY` + destination allowlist + adapter max mode). Facebook intake’s `nextAction` is always “Review and approve simulation in Admin C.O.C.”

### A.7 Inventory / commerce today (critical)

`processFacebookSourceLead` always calls `trackCampaignInventorySafely` after routing, even when the flag path has already normalized.

Campaign tracking (`campaign-inventory-tracking.service.ts`):

- Allowed lanes: `meta_lead_ads`, `leadcapture_io`.
- Creates/reuses `InventoryLot` keyed `campaign:meta_lead_ads:{campaignKey}:{niche}`.
- Creates `LeadInventoryItem` with `inventoryClass: "aged"`, `exclusivityMode: "configurable"`.
- May set `status: "available"` via `assessCampaignInventoryIntakeActivation`.
- Sets `commerceEligible` from age: 0–10d `FRESH_HOLD`, 10–30d `SEMI_FRESH_HOLD`, then PPL purchasable buckets.
- Stamps `originClientAccountId` **only** when `sourceProvider === "leadcapture_io"` and a confirmed `SourceFunnel` exists. Facebook events get **null origin**.
- PPL `isOriginClientBuyerIneligible` only blocks the *origin client* from buying that item. Null origin ⇒ other buyers can purchase once age/commerce predicates pass.
- `commerceExcludedAt` exists as a permanent commerce kill switch but is **not** set by Facebook intake.

LeadCapture NextGen’s `inventory_only` stage is the opposite product: it *intentionally* builds resale/aged inventory and **skips** routing. Meta campaign leads must not inherit that stage.

### A.8 Feature flags / runtime gates already in tree

| Mechanism | Role | Safe default |
| --- | --- | --- |
| `FACEBOOK_DIRECT_INTAKE_ENABLED` | Direct Meta Graph+routing | `false` (raw persist only) |
| `GHL_DELIVERY_ADAPTER_MAX_MODE` / `ghl.delivery_mode` | Delivery ceiling | `simulate` |
| `SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS` / `_LOCATION_IDS` | Live destination allowlist | unset = deny |
| `SA360_GHL_LIVE_CANARY_ALLOWED` | Live canary | false unless set |
| `META_DISPATCH_MODE` / `meta.dispatch_mode` / `META_SYNC_ENABLED` | CAPI enqueue | safe default `disabled`; truthy `META_SYNC_ENABLED` maps to **simulate**, never live |
| `ROUTING_MODE` / `routing.mode` | Routing execution | `dry_run` |
| `SA360_LF2_*` allowlists | LF2 GHL canary | deny-by-default |
| `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` | NextGen staged rollout | `capture_only` if unset |
| Admin C.O.C. `AdminRuntimeSetting` | DB overlay for delivery/meta/routing modes | never stores secrets |

There is **no** `FeatureFlag` Prisma model. Do not create one. Env + `AdminRuntimeSetting` is the existing source of truth.

### A.9 Admin C.O.C. surfaces already present

| UI | Path | Meta relevance |
| --- | --- | --- |
| Source Intake Queue | `/source-intake` | Lists `SourceLeadEvent`; filter `system=meta_lead_ads` already tested |
| Webhook Monitor | `/webhooks` | Logs `WebhookRequestLog`; **URL filter currently forwards only `ghl_lifecycle` and `synthflow_inbound_lookup`** — `facebook_lead_ads` is dropped |
| Routing dry-run | `/routing-dry-run` | Decisions + unmatched review queue |
| Lead inventory review | `/lead-inventory` (review queue) | Must not receive Meta campaign leads in Phase 1 |
| Fulfillment ops / LF2 | gated | Out of Phase 1 |
| GHL OAuth / connections | `/ghl-connections` | Destination credentials; not an intake path |

### A.10 Naming debt (do not fork a fourth lane)

Production already uses several aliases for the same conceptual source:

| Token | Where |
| --- | --- |
| `meta_lead_ads` | `SourceLeadSystem`, inventory `sourceLane`, proof policy, Facebook `FACEBOOK_LEAD_SOURCE_SYSTEM` |
| `facebook_lead_ads` | `WebhookRequestSource` |
| `facebook_meta_lead_ads` | LF2 canonical lane alias → proof policy `meta_lead_ads` |
| `facebook` | `SourceLeadProvider` |
| `facebook_lead_form` | `attribution.source_type` / routing scope |
| `/sources/facebook/lead-created` | Current public HTTP path |

**Canonical product name for Phase 1:** source adapter `meta_lead_ads` (system + inventory lane + proof policy). Keep provider `facebook`. Do not introduce a new provider enum.

---

## B. Exact files / modules / models / routes to reuse

### HTTP and auth

- `apps/api/src/routes/sources-facebook.ts` — existing GET verify + POST leadgen + test-lead
- `apps/api/src/routes/sources-facebook.routes.test.ts`
- `apps/api/src/lib/meta-webhook.ts` + `.test.ts` — verify token, HMAC-SHA256, config, fail-closed production
- `apps/api/src/app.ts` — plugin registration
- `apps/api/src/services/webhook-request-log.service.ts`
- `apps/api/src/lib/webhook-payload-redact` (via `@sa360/shared` `redactWebhookPayloadForLog`)

### Adapter / normalize / Graph

- `apps/api/src/services/source-intake/facebook-lead-intake.service.ts`
- `apps/api/src/services/source-intake/facebook-lead-normalizer.ts` + `.test.ts`
- `apps/api/src/services/source-intake/meta-lead-graph.service.ts`
- Replay pattern to copy: `leadconduit-facebook-intake.service.ts` (`findReplayEvent` by `sourceLeadUid`) and NextGen `findCorrelatedSourceLeadEvents`
- Stage-gate pattern to copy: `leadcapture-nextgen-stage.ts` (do **not** reuse NextGen’s `inventory_only` semantics)

### Routing / identity / proof

- `apps/api/src/services/source-intake/source-intake-routing-persist.ts`
- `apps/api/src/services/routing-dry-run.service.ts`
- `apps/api/src/services/routing-matcher.service.ts`
- `apps/api/src/lib/routing-attribution-extract.ts`
- `apps/api/src/services/source-intake/source-lead-duplicate-risk.service.ts`
- `apps/api/src/repositories/campaign-routing-rule.repository.ts`
- `apps/api/src/services/lead-proof/lead-proof-ingest.service.ts`
- `apps/api/src/schemas/lifecycle-event.schema.ts`, `lifecycle-event-names.ts`

### Models (reuse, do not duplicate)

- `SourceLeadEvent`, `SourceLeadProvider.facebook`, `SourceLeadSystem.meta_lead_ads`, `SourceLeadType.lead_form|webhook`
- `WebhookRequestLog`, `WebhookRequestSource.facebook_lead_ads`
- `CampaignRoutingRule`, `RoutingDryRunDecision`
- `LifecycleEvent` (routing audit events only)
- `LeadProof` / `LeadProofArtifact` (`LeadProofArtifactProvider.meta_lead_ads`)
- `LeadAttribution` (optional later; not required for Phase 1 shadow)
- `InboundContactIndex` (GHL/voice; **do not write** in Phase 1)
- `AdminRuntimeSetting` keys `ghl.delivery_mode`, `meta.dispatch_mode`, `routing.mode`

### Admin C.O.C.

- `apps/admin-coc/src/app/(dashboard)/source-intake/page.tsx`
- `apps/admin-coc/src/lib/source-intake/source-intake-query.ts` + `source-intake-facebook-filter.test.ts`
- `apps/admin-coc/src/app/(dashboard)/webhooks/page.tsx` + `webhook-monitor-query.ts`
- `apps/admin-coc/src/app/(dashboard)/routing-dry-run/` (unmatched review)
- `apps/api/src/routes/admin-source-leads.ts`

### Do **not** reuse as the Meta Graph worker

- `apps/api/src/services/queue-service.ts` `enqueueMetaDispatch` / worker `META_DISPATCH_QUEUE` (CAPI outbound)
- `apps/api/src/routes/webhook.ts` GHL lifecycle (legacy Facebook→GHL contract)
- `source-lead-delivery.service.ts` `approveSourceLeadDelivery` (operator live path; leave gated)
- `campaign-inventory-tracking.service.ts` for committed Meta campaign leads in Phase 1
- LeadCapture NextGen `inventory_only` stage
- `ensureFulfillmentOutboxForSourceLead` / LF2 GHL canary

---

## C. Proposed implementation seam

**One adapter, two HTTP faces, one processing function.**

1. Keep `processFacebookSourceLead` as the canonical processor (conceptually `processMetaLeadAdsIntake`).
2. Add **additive** public routes that Meta’s app dashboard can subscribe to:
   - `GET /webhooks/meta/leadgen` — hub challenge
   - `POST /webhooks/meta/leadgen` — leadgen notifications  
   Implementation: same plugin as `sources-facebook.ts` (shared raw-body JSON parser + HMAC). Do **not** fork a second signature implementation.
3. Keep `GET/POST /sources/facebook/lead-created` as a compatibility alias in Phase 1 (same handlers). Do not delete it until Meta’s subscription is confirmed on the new path.
4. Keep `POST /sources/facebook/test-lead` as the **fixture / no-Graph** path (already exists).
5. Split the POST into two phases:
   - **Request thread (always fast, always 200 after auth):** verify signature, log webhook, extract envelopes, **idempotent persist** of notification, enqueue Graph fetch **only if** intake+fetch flags are on.
   - **Worker / deferred job:** Graph GET, normalize, dry-run route, stop. No GHL, no CAPI, no inventory commerce.
6. Register the Meta normalizer in `SOURCE_LEAD_NORMALIZERS` **only if** a generic dispatcher starts using it. Until then, dedicated Facebook/Meta services remain the source of truth (avoid a second code path).

### Why this is the cleanest seam

- Enums, webhook source, proof policy, Admin filter, and Graph client already exist.
- Routing dry-run is already the shared engine (`persistRoutingAndDuplicate`).
- NextGen-style stages are the right *rollout* pattern, but NextGen’s `inventory_only` is the wrong *product* for client-committed Meta leads.
- LeadConduit is the right *replay* pattern, not the right public Meta webhook (different auth, different payload, Zapier-adjacent vendor).

---

## D. Data-model changes (if any)

Phase 1 can ship **without a migration** if replay is application-level (LeadConduit/NextGen style). A later Auth/Account migration is recommended, not required to start.

### D.1 Reuse as-is (no new tables)

| Concern | Store where |
| --- | --- |
| Meta lead ID (`leadgen_id`) | `SourceLeadEvent.sourceLeadId`; `sourceLeadUid = facebook-meta_lead_ads-{leadgenId}`; `routing.source_intake.lead_id`; `LeadProof.sourceLeadId` |
| Page ID | `routing.page_id` (already on Facebook normalizer); also in `rawPayloadJson.envelope.pageId` |
| Form ID / name | `routing.form_id` / `routing.form_name`; `sourceRouteKey` prefers form ID; `sourceFunnelName` = form name; `LeadProof.formId/formName` |
| Campaign ID / name | `SourceLeadEvent.sourceCampaignId/Name`; `attribution.campaign_id/name`; `LeadProof.campaignId/Name` |
| Ad set ID / name | `attribution.adset_id/name`; Graph fields; envelope `adgroup_id` |
| Ad ID / name | `attribution.ad_id/name`; `LeadProof.adId/adName` |
| Generated / source timestamp | `routing.source_intake.created_time` / `generated_at` / `submitted_at` (Graph `created_time`). Authoritative age if inventory is ever created: **not** `receivedAt` |
| Raw payload / evidence | `SourceLeadEvent.rawPayloadJson` (envelope + token-free Graph body); `WebhookRequestLog.requestBodyRedacted`; `LeadProof.rawSourcePayload` |
| Client ownership / committed destination | **Routing match:** `clientAccountIdResolved` + `destinationLocationIdResolved` + `routingRuleIdResolved` on `SourceLeadEvent`; `RoutingDryRunDecision`. **Do not** treat this as inventory origin. |
| Source lane | `enrichmentMetadataJson.sourceLane = "meta_lead_ads"`; `SourceLeadSystem.meta_lead_ads`; proof lane `meta_lead_ads` |
| Inventory / commerce eligibility | Phase 1: **do not create `LeadInventoryItem`**. If a later phase persists supply, require `commerceExcludedAt` set, `exclusivityMode: exclusive`, `originClientAccountId` = matched client, `inventoryClass: fresh` (not `aged`), and PPL selection must deny `sourceLane=meta_lead_ads` unless an allowlist exists |

### D.2 Additive changes recommended (later, Auth/Account)

1. **Partial unique index** on `SourceLeadEvent (sourceProvider, sourceSystem, sourceLeadId)` where `sourceLeadId IS NOT NULL` — webhook idempotency under concurrency. Today the index is non-unique.
2. Optional `WebhookRequestSource` value `meta_lead_ads` **or** keep `facebook_lead_ads` and document it as the Meta leadgen log source (preferred: keep enum, avoid migration).
3. Do **not** add a `FeatureFlag` model.
4. Do **not** add Meta-specific tables (`MetaLead`, `MetaPage`, etc.) in Phase 1. Page/form/campaign IDs fit existing JSON + routing rule columns.
5. `SourceFunnel` is LeadCapture-shaped (`providerFunnelId` / `parentUrlKey`). Reusing it for Meta form IDs is a **later** product decision (see §K). CampaignRoutingRule already matches `formId` / `campaignId` / `adId`.

### D.3 Enum / field additions **not** needed in Phase 1

- New `SourceLeadProvider` (keep `facebook`)
- New `SourceLeadSystem` (keep `meta_lead_ads`)
- New lifecycle event names for every observability verb (map onto existing `SourceLeadEvent.status` + `WebhookRequestLog.processingStatus` + existing routing lifecycle names)

---

## E. Proposed env vars

Secrets stay in env. Never `NEXT_PUBLIC_`. Never persist tokens in `rawPayloadJson` or logs.

### Already implemented (keep)

| Variable | Purpose | Phase 1 |
| --- | --- | --- |
| `META_WEBHOOK_VERIFY_TOKEN` | GET `hub.verify_token` | required to subscribe |
| `META_APP_SECRET` | `X-Hub-Signature-256` | **required in production** (fail-closed) |
| `META_PAGE_ACCESS_TOKEN` | Graph lead fetch | required only when fetch enabled |
| `META_GRAPH_API_VERSION` | default `v22.0` | keep |
| `SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID` | matcher master account | required for routing dry-run |
| `FACEBOOK_DIRECT_INTAKE_ENABLED` | Graph+process vs raw-only | keep as emergency kill; default `false` |

### Additive (recommended names)

| Variable | Default | Purpose |
| --- | --- | --- |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | `false` | Master intake flag (alias or successor of `FACEBOOK_DIRECT_INTAKE_ENABLED`) |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | `false` | Allow Graph fetch / worker processing |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | `false` | Allow `runRoutingDryRun` (still dry-run only) |
| `SA360_META_LEAD_ADS_INVENTORY_TRACKING_ENABLED` | `false` | Must stay false in Phase 1 |
| `SA360_META_LEAD_ADS_ASYNC_FETCH` | `true` when worker exists | Enqueue Graph fetch instead of blocking POST |
| `SA360_META_LEAD_ADS_FIXTURE_ENABLED` | `true` in non-prod, `false` in prod | `POST /sources/facebook/test-lead` |
| `SA360_META_LEAD_ADS_ALLOWED_PAGE_IDS` | unset = deny fetch | Optional page allowlist |
| `SA360_META_LEAD_ADS_ALLOWED_FORM_IDS` | unset = no extra filter | Optional form allowlist |

Do **not** set `META_DISPATCH_MODE=live`, `GHL_DELIVERY_ADAPTER_MAX_MODE=live_canary`, or LF2 canary flags as part of this work.

`META_DATASET_ID` / `META_ACCESS_TOKEN` / `ClientConfig.meta*` are **CAPI dispatch** credentials, not Lead Ads intake. Do not reuse them for Graph lead fetch.

---

## F. Proposed feature flags / kill switches

Layered deny-by-default (same style as NextGen + GHL adapter ceiling):

1. **HTTP subscribe** — `META_WEBHOOK_VERIFY_TOKEN` present. GET handshake can succeed while processing stays off.
2. **Accept notifications** — always persist+log after signature (so Meta retries do not storm). This is *capture*, not *intake*.
3. **`SA360_META_LEAD_ADS_INTAKE_ENABLED` / `FACEBOOK_DIRECT_INTAKE_ENABLED`** — off: stop after raw `SourceLeadEvent`.
4. **`SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED`** — off: do not call Graph (fixtures/test-lead still work).
5. **`SA360_META_LEAD_ADS_ROUTING_ENABLED`** — off: normalized but no `runRoutingDryRun` (mirrors NextGen before `normalize_route_proof`).
6. **Hard-coded Phase 1 denies** (not env-promotable without a later PR):
   - no `approveSourceLeadDelivery`
   - no `ensureFulfillmentOutboxForSourceLead`
   - no `enqueueMetaDispatch`
   - no `trackCampaignInventorySafely` unless inventory flag is explicitly true **and** ownership policy is implemented (Phase 1: flag false and call site removed/skipped)
7. **Global ceilings that must remain** — `ghl.delivery_mode=simulate`, `meta.dispatch_mode=disabled|simulate`, `routing.mode=dry_run`.

Optional later: `AdminRuntimeSetting` key `meta_lead_ads.intake_stage` with values `disabled | capture_only | normalize_route_shadow | (future) live_canary`. Do not add `inventory_only` as a Meta stage name; it collides with LeadCapture resale semantics.

---

## G. Request lifecycle diagram

```
                    Meta Graph webhook
                            |
              GET /webhooks/meta/leadgen
              hub.mode=subscribe
                            |
              verify token (timing-safe)
                            |
              200 text/plain challenge
              WebhookRequestLog: source=facebook_lead_ads
                                 route=/webhooks/meta/leadgen
                                 processingStatus=handshake_ok|handshake_denied
                            |
              POST /webhooks/meta/leadgen
              X-Hub-Signature-256 + raw body
                            |
              startLog (redacted body, never tokens)
                            |
         +------------------+------------------+
         | fail-closed prod missing secret     |
         | bad HMAC → 401 logged               |
         | bad JSON → 200 logged validation    |
         +------------------+------------------+
                            |
              extract leadgen envelopes
              (empty → 200 processed=0)
                            |
              for each leadgen_id:
                idempotent find (provider=facebook,
                                 system=meta_lead_ads,
                                 sourceLeadId=leadgen_id)
                  exists → ack, do not create second event
                  new → SourceLeadEvent status=received
                         rawPayloadJson={ envelope }
                         webhookRequestLogId
                            |
              HTTP 200 { ok, processed, intakeEnabled }
              (Meta retry-safe; work continues async)
                            |
              if intake+fetch flags off: STOP (capture_only)
                            |
              enqueue meta-leadgen-fetch job
              (NOT meta-dispatch)
                            |
              Worker:
                Graph GET lead fields (token in URL only)
                mapMetaLeadToFacebookFields
                normalizeFacebookLeadToLifecyclePayload
                  send_to_meta=false
                  source_type=facebook_lead_form
                lifecycleEventSchema validate
                  fail → status=needs_review
                if routing flag on:
                  persistRoutingAndDuplicate
                    runRoutingDryRun only
                    matched → routing_matched + lead_matched + lead_routed_dry_run
                    unmatched → routing_unmatched + routing_review_required
                    duplicate sourceLeadId → duplicate_blocked (replay should prevent)
                LeadProof persist (best-effort)
                DO NOT trackCampaignInventory
                DO NOT upsert InboundContactIndex
                DO NOT enqueue CAPI
                DO NOT plan/execute GHL delivery
                            |
              Admin C.O.C.
                Webhook Monitor (facebook_lead_ads)
                Source Intake (system=meta_lead_ads)
                Routing dry-run unmatched queue
```

Fixture path (no Meta app): `POST /sources/facebook/test-lead` → same processor with `coerceFacebookLeadFields`, `sourceType=webhook`, Graph skipped.

---

## H. Meta lead ownership / inventory classification

### Policy (Phase 1)

A Meta Lead Ad generated for a **specific campaign/client** is a **committed delivery candidate**, not general supply.

| Attribute | Phase 1 value |
| --- | --- |
| Product lane | Client-committed Meta campaign lead |
| Inventory row | **None** |
| PPL / aged resale | **Ineligible** |
| Aging clock | Must not start (no `LeadInventoryItem.generatedAt` supply row) |
| Exclusive to matched client | Expressed via routing destination + (later) origin stamp, not via `available` inventory |
| LeadCapture inventory_only | Must not run |

### Why current code violates this if intake is enabled

`trackCampaignInventoryFromSourceEvent` for `meta_lead_ads`:

- writes `LeadInventoryItem` with `inventoryClass: "aged"` from birth
- `exclusivityMode: "configurable"` (shareable)
- no Facebook origin stamp
- activation can set `available`
- commerce lifecycle becomes purchasable after 30 days

That is the LeadCapture **inventory** behavior, not client-committed campaign delivery.

### Later-phase (not Phase 1) if a supply row is required for analytics

Only with an explicit ownership policy PR:

- `sourceLane: "meta_lead_ads"`
- `exclusivityMode: "exclusive"`
- `originClientAccountId` = matched `CampaignRoutingRule.clientAccountId` (not master)
- `commerceExcludedAt` set at create (`reason=client_committed_meta_campaign`)
- `status: pending_review` (never auto-`available`)
- PPL `inventory-selection.service.ts` must **hard-deny** `sourceLane in (meta_lead_ads, facebook_meta_lead_ads)` unless a future commerce policy allowlists them
- Facet rebuilds must not count these as aged supply

P2 origin exclusion (`origin === buyer`) is **insufficient** by itself: it only stops the origin client from buying their own lead as PPL; other buyers can still purchase a null-origin available item.

### Routing ownership vs inventory origin

- **Routing destination** = who should receive the lead in GHL (shadow in Phase 1).
- **Inventory origin** = who the lead was generated for, for PPL exclusion.
- Confirmed SourceFunnel is the LeadCapture mechanism. For Meta, `CampaignRoutingRule` (form_id / campaign_id / ad_id) is the Phase 1 ownership registry. Do not guess a customer when no rule matches.

---

## I. Test matrix

Existing tests to keep green (do not weaken):

- `apps/api/src/lib/meta-webhook.test.ts`
- `apps/api/src/routes/sources-facebook.routes.test.ts`
- `apps/api/src/services/source-intake/facebook-lead-normalizer.test.ts`
- `apps/api/src/services/source-intake/campaign-inventory-intake.contract.test.ts` (generated_at mapping)
- `apps/api/src/services/routing-dry-run.service.test.ts`
- `apps/admin-coc/src/lib/source-intake/source-intake-facebook-filter.test.ts`

### Phase 1 additions

| # | Case | Expected |
| --- | --- | --- |
| 1 | GET handshake valid token | 200 challenge; log `handshake_ok` |
| 2 | GET bad token | 403; log `handshake_denied` |
| 3 | POST missing secret in production | 503 `integration_not_configured` |
| 4 | POST valid HMAC, intake flag off | 200; `SourceLeadEvent.received`; no Graph mock call; no inventory item; no dry-run decision |
| 5 | POST invalid HMAC | 401; no event |
| 6 | POST invalid JSON | 200; `validation_failed`; Meta does not retry-storm |
| 7 | POST no leadgen changes | 200 `processed: 0` |
| 8 | POST same `leadgen_id` twice | one `SourceLeadEvent`; second is replay |
| 9 | Concurrent duplicate POSTs | one winner; no two inventory/routing rows |
| 10 | Fixture `test-lead` | normalize + optional dry-run; Graph unused; `send_to_meta=false` |
| 11 | Graph fetch enabled, Graph 4xx | event stays `received`/`needs_review` with errorSummary; HTTP 200 already sent |
| 12 | Normalize missing identity | `needs_review`; no GHL |
| 13 | Routing match on `form_id` / `campaign_id` | `routing_matched`; `RoutingDryRunDecision`; lifecycle `lead_matched` + `lead_routed_dry_run`; `send_to_meta=false` |
| 14 | No matching rule | `routing_unmatched`; `routing_review_required`; **no** default client |
| 15 | Keyword-only match | treat as review in Phase 1 (optional: do not auto-trust `keyword_fallback` for Meta) — **human decision** |
| 16 | Inventory tracking | **zero** `LeadInventoryItem` for `sourceLane=meta_lead_ads` |
| 17 | `approveSourceLeadDelivery` not invoked by webhook/worker | assert mock never called |
| 18 | `enqueueMetaDispatch` not invoked | assert |
| 19 | `InboundContactIndex` not upserted | assert |
| 20 | GHL lifecycle webhook regression | existing `webhook.ts` tests unchanged |
| 21 | LeadConduit Facebook regression | existing route tests unchanged |
| 22 | Admin webhook monitor `source=facebook_lead_ads` | forwarded to API (today it is dropped) |
| 23 | Admin source-intake `system=meta_lead_ads` | lists events |
| 24 | Token never in logs / `rawPayloadJson` | redact tests |
| 25 | Page allowlist miss | persist raw; skip fetch |

---

## J. Smallest safe PR sequence

Do not enable any delivery path. Each PR stays reviewable and default-off.

### PR 0 — this document (design only)

`docs/architecture/meta-lead-ads-direct-intake-phase-1.md`

### PR 1 — Public webhook alias + handshake logging (no behavior change when flags off)

**Ingestion lane.**

- Add `GET/POST /webhooks/meta/leadgen` sharing `sources-facebook.ts` handlers.
- Log GET handshake via `startLog`/`completeLog`.
- Keep `/sources/facebook/lead-created`.
- Fix Admin webhook monitor to accept `source=facebook_lead_ads` (and `leadcapture_io`) in `webhookMonitorToAdminApiParams` — small Quality overlap; include if needed for observability, else document as Quality follow-up.
- Tests: handshake, alias POST with intake disabled.

**Does not:** Graph, routing changes, inventory, unique index.

### PR 2 — Idempotent replay for Meta `leadgen_id`

**Ingestion lane. No migration.**

- Before `createSourceLeadEvent`, `findFirst` by `(facebook, meta_lead_ads, leadgenId)` (copy LeadConduit/NextGen).
- Replay returns existing id; do not re-run Graph/routing if already past `received` unless a later “promote” path is explicit.
- Tests: double POST, test-lead replay.

Optional follow-up (Auth/Account, authorized separately): unique partial index.

### PR 3 — Skip campaign inventory for Meta campaign leads

**Ingestion lane. Highest safety value.**

- `processFacebookSourceLead` must **not** call `trackCampaignInventorySafely` unless `SA360_META_LEAD_ADS_INVENTORY_TRACKING_ENABLED=true` (default false).
- Contract test: Facebook normalize still maps `generated_at`; **no** item insert.
- This PR may land even before async fetch; it closes the resale hole if someone enables `FACEBOOK_DIRECT_INTAKE_ENABLED` in staging.

### PR 4 — Async Graph fetch (non-blocking POST)

**Ingestion + Worker contract.**

- New queue name e.g. `meta-leadgen-fetch` (not `meta-dispatch`).
- POST persists envelope and enqueues; worker calls existing `fetchMetaLeadDetails` + `processFacebookSourceLead`.
- Injection points already exist (`fetchMetaLeadDetailsImpl`).
- Worker test: job payload has `sourceLeadEventId` + `leadgenId` only (no token in Redis payload; worker reads env).
- Document worker env: same `META_PAGE_ACCESS_TOKEN`.

If worker queue is deferred, an acceptable interim is Fastify `request.raw` already acked… **do not** use fire-and-forget without durable `SourceLeadEvent`; use `setImmediate` only as a local-dev fallback, not production.

### PR 5 — Shadow routing behind its own flag

**Ingestion lane.**

- Gate `persistRoutingAndDuplicate` on `SA360_META_LEAD_ADS_ROUTING_ENABLED`.
- Default false so capture+normalize can be proven first (NextGen `capture_only` analog).
- When on: existing dry-run only; unmatched → review; `send_to_meta: false`.
- Optional: reject `keyword_fallback` as unmatched for Meta (see §K).

### PR 6 — Admin C.O.C. observability (smallest useful surface)

**Quality lane preferred.**

Map Phase 1 verbs onto existing fields (no new lifecycle enum required):

| Verb | Existing field |
| --- | --- |
| `source_lead_received` | `SourceLeadEvent.status=received` + log `processingStatus=received\|processed\|intake_disabled` |
| `lead_normalized` | `status=normalized` (today Facebook jumps to routing statuses; persist `normalized` timestamp already exists) |
| `duplicate_detected` | `status=duplicate_blocked` + `duplicateRiskJson` |
| `routing_matched` | `status=routing_matched` + dry-run decision |
| `routing_review_required` | `status=routing_unmatched` + lifecycle `routing_review_required` |
| `routing_shadow_planned` | `routingResultJson` + `lead_routed_dry_run` (name in UI only) |
| `processing_failed` | `errorSummary` + log `processingStatus=failed` / Graph fail |

UI: Source Intake status badges already cover matched/unmatched/needs_review/duplicate. Add a Meta filter chip if missing. Webhook Monitor source dropdown: include `facebook_lead_ads`.

### Explicitly out of Phase 1 (later PRs)

- Live GHL / workflow / opportunity create
- CAPI / conversion return to Meta
- SourceFunnel-for-Meta-forms
- Unique index migration
- Per-page OAuth tokens / Tech Provider multi-tenant
- Inventory commerce policy for Meta
- Deleting `/sources/facebook/lead-created`

---

## K. Blockers that need a human decision BEFORE code is written

1. **Public Meta callback URL**  
   Subscribe Meta to `/webhooks/meta/leadgen` (recommended) vs keep `/sources/facebook/lead-created` only vs both. Affects App Review and existing staging subscriptions.

2. **Inventory for Meta in Phase 1**  
   Recommendation: **no `LeadInventoryItem`**. Alternative: create excluded exclusive rows for analytics. Do not leave current `trackCampaignInventorySafely` enabled.

3. **Unique constraint vs application replay**  
   Replay-without-migration can ship in Ingestion. A unique index needs Auth/Account authorization and a backfill plan for existing duplicate Facebook events (if any exist in prod).

4. **`keyword_fallback` matches**  
   Matcher may assign a client on a loose keyword. For Meta, should Phase 1 treat only `campaign_id` / `adset_id` / `ad_id` / `form_id_utm_campaign` as a match and send keyword/UTM-only to review?

5. **Master account vs destination**  
   Routing rules key off `SA360_FACEBOOK_MASTER_CLIENT_ACCOUNT_ID`. Confirm the production master id and that rules will be scoped `sourcePlatform=facebook` + `sourceType=facebook_lead_form` so LeadCapture rules cannot swallow Meta leads (and vice versa). See `docs/operations/pilot-client-cutover-runbook.md`.

6. **Single page token vs per-page tokens**  
   Code assumes one `META_PAGE_ACCESS_TOKEN`. Multi-page / Tech Provider will need a token map. Phase 1 page allowlist is enough only if one Page is in scope.

7. **Tech Provider / Business Verification pending**  
   Confirm Phase 1 production posture: handshake + capture_only with fixtures, **no** live Graph in production until verification lands.

8. **Should Facebook intake write `LeadAttribution` / `InboundContactIndex`?**  
   Today it does not (Google Sheet does). Writing `InboundContactIndex` would surface Meta leads in Action Center / voice as if they were GHL contacts. Recommendation: **not in Phase 1**.

9. **Rename `FACEBOOK_DIRECT_INTAKE_ENABLED`**  
   Additive `SA360_META_LEAD_ADS_*` vs reuse. Recommendation: new names honoring old env as alias so existing staging configs do not silently change.

10. **Worker ownership**  
    New `meta-leadgen-fetch` queue touches `apps/worker`. Ingestion can add the producer; worker processor is a documented cross-package contract (root rule 10: one queue definition).

11. **Do not enable `FACEBOOK_DIRECT_INTAKE_ENABLED` in production** until PR 3 (inventory skip) is merged. Enabling current master in production would create aged-class inventory rows for Meta leads.

---

## Answers to the numbered audit questions

1. **Cleanest seam for `meta_lead_ads`:** existing dedicated Facebook intake (`sources-facebook.ts` + `facebook-lead-intake.service.ts` + `facebook-lead-normalizer.ts` + `meta-lead-graph.service.ts`), not the LeadCapture normalizer registry, not LeadConduit, not GHL lifecycle. Add `/webhooks/meta/leadgen` as the Meta-facing alias.

2. **Reuse:** `SourceLeadEvent`, `WebhookRequestLog`, `CampaignRoutingRule`, `RoutingDryRunDecision`, `LifecycleEvent` (routing names only), `LeadProof`, MASTER 2.0 schema, `runRoutingDryRun` / `persistRoutingAndDuplicate`, Admin source-intake + routing-dry-run.

3. **Additive changes:** env/flags; application-level idempotency; skip inventory tracking; async fetch queue; webhook path alias; Admin monitor source filter. Schema unique index optional later. No new provider/system enums.

4. **Representation:** see §D.1 (IDs on `SourceLeadEvent` + `attribution` + `routing.source_intake` + `LeadProof`; lane `meta_lead_ads`; commerce = no inventory row).

5. **Webhook idempotency:** key = `(facebook, meta_lead_ads, leadgen_id)`. Replay existing `SourceLeadEvent`. HTTP 200 on retries. Unique index later. Do not use Graph lead body as the first idempotency key (notification can arrive before fetch).

6. **Logging:** same `startLog`/`completeLog` as LeadCapture/Facebook. `source=facebook_lead_ads`. `route=/webhooks/meta/leadgen` (and alias route string for the old path). Log GET handshake (missing today). Redact tokens. Invalid payload → 200 + `validation_failed`. Fix C.O.C. monitor query to pass `facebook_lead_ads` through.

7. **Signature:** keep `validateMetaSignature` HMAC-SHA256 over **raw bytes** (`rawBody` content-type parser already scoped to the Facebook plugin). Fail closed in production without `META_APP_SECRET`. Timing-safe compare. Do not JSON-restringify before HMAC.

8. **Graph handoff:** persist envelope first, ACK 200, enqueue durable job; worker uses `fetchMetaLeadDetails`. Do not block Meta’s webhook on Graph latency. Do not put the page token in the job payload.

9. **Fixtures while verification pending:** existing `POST /sources/facebook/test-lead` + `coerceFacebookLeadFields`. Keep Graph optional. Capture-only production handshake. Unit tests already mock `fetchMetaLeadDetailsImpl`.

10. **Shadow routing:** only `persistRoutingAndDuplicate` → `runRoutingDryRun`. Never `approveSourceLeadDelivery`, never LF2 outbox, never delivery plan execution. Gate with `SA360_META_LEAD_ADS_ROUTING_ENABLED`.

11. **Unmatched:** existing matcher returns unmatched → `routing_unmatched` + `routing_review_required`. No default client. Operators create/accept `CampaignRoutingRule` in C.O.C. Do not keyword-guess unless product explicitly allows it.

12. **Accidental side-effect paths and Phase 1 prevention:** see table below.

13. **C.O.C. observability:** Source Intake + Webhook Monitor + Routing dry-run; map verbs in §J PR 6. Smallest change: stop dropping `facebook_lead_ads` in the monitor query.

14. **Flags:** §F. Master off; Graph off; routing off; inventory off; GHL simulate; CAPI disabled.

### Accidental path map (question 12)

| Path | Code | Phase 1 prevention |
| --- | --- | --- |
| Deliver to GHL / create contact | `approveSourceLeadDelivery` → `runDirectDemoDelivery`; bulk-import worker; LF2 GHL canary | Do not call from Meta worker. Adapter max mode `simulate`. Allowlists unset. |
| Create opportunities / start workflows | GHL live adapter steps inside live canary | Same; live canary confirmation text required even if someone clicks Approve |
| Mark inventory available / resale | `trackCampaignInventorySafely` → `LeadInventoryItem.status=available` | **Skip call**; inventory flag false |
| Age into PPL | `generatedAt` + `isPurchasableInventoryCommerceLifecycle` after 30d | No inventory row ⇒ no age clock |
| Dispatch Meta CAPI | `webhook.ts` `enqueueMetaDispatch` when `send_to_meta !== false`; worker `meta-dispatch` | Facebook normalizer sets `send_to_meta: false`; routing events also false; `meta.dispatch_mode` not live; do not enqueue from Meta intake |
| InboundContactIndex / Action Center as GHL lead | `upsertFromLifecyclePayload` on GHL webhook | Do not upsert from Meta intake |
| LF2 shadow allocation | `ensureFulfillmentOutboxForSourceLead` (NextGen `shadow_fulfillment`) | Do not call |
| DeliveryInstruction / adapter execute | `planDeliveryInstructionsForAllocation` after allocation | No allocation |
| Legacy Zapier Facebook→GHL | `POST /webhooks/ghl/lifecycle-event` | Untouched contract |

---

## Follow-up dependencies (other lanes)

- **Auth/Account:** unique index migration if approved (§K.3).
- **Quality:** Webhook Monitor source filter + Source Intake Meta chip/copy.
- **Worker package:** `meta-leadgen-fetch` consumer (same contract as producer).
- **Portal:** none.
- **Production infra / Meta app:** human-only (verify token, callback URL, Page token). This design does not deploy or change DigitalOcean config.

---

## Implementation notes for the first coding agent

- Work from latest `origin/master`; do not enable flags in production.
- Prefer editing `sources-facebook.ts` / `facebook-lead-intake.service.ts` over creating a parallel `meta-lead-ads-intake.service.ts`.
- Preserve LeadConduit and GHL webhook contracts.
- Never log `META_PAGE_ACCESS_TOKEN` / `META_APP_SECRET`.
- A failing test is better than skipping one.

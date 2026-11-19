# SA360 client multi-campaign / multi-niche v1 — branch contract

Status: DESIGN / IMPLEMENTATION PLAN ONLY. No production writes, migrations, flags, routing changes, GHL calls, Google appends, or live delivery activation are authorized by this document.

Branch: `feature/client-multi-campaign-niche`
Baseline: current `master` as of 2026-11-19 (includes merged #347, #349, #359, #362, #363). Reconcile with the latest master and open PRs before implementation.

## Product goal
One `ClientAccount` can manage multiple independently configured campaign lanes, including two campaigns in the same niche and campaigns in different niches. Each lane has a clear source association, stable attribution, explicit classification, specific GHL workflow and Sheets output where needed, scoped readiness, and independent pause/activation with audit. Existing single-campaign clients must behave identically until migrated/opted in.

Example:
- Ray Rodriguez / Veteran FEX / LeadCapture page A -> GHL location Ray, VET workflow, worksheet Vet.
- Ray Rodriguez / Nurse Life / LeadCapture page B -> same GHL location, NURSE workflow, worksheet Nurse.
- Ray Rodriguez / Veteran FEX / separate Meta form C -> same niche but distinct campaign/source/attribution; can share approved destination settings.

Distinguish clearly:
1. Client account: tenant, billing, profile, operational shared integrations.
2. Niche: classification (existing `primaryNicheKeys` list; `MTG` stored key for Mortgage).
3. Product: `life_insurance`, `health_insurance`, `other` profile selection (legacy values remain readable).
4. Campaign: one client's lead acquisition / fulfillment configuration lane.
5. Source: one or more actual LeadCapture pages, Meta forms or exact campaign identifiers.
6. Lead Type: explicit output label, *not inferred* from niche or URL; current controlled labels `Vet Web Form`, `Nurse Web Form`, `Trucker Web Form`.
7. Destination: shared client GHL location and company Google account; specific workflow/tab choices may differ per campaign.

## Verified current architecture and constraints
- `ClientAccount.primaryNicheKeys` and `primaryProductTypes` are JSON lists. `ClientAccount.routingRules` is one-to-many.
- `CampaignRoutingRule` has match identifiers, `nicheKey`, `productType`, per-rule `destinationWorkflowIdGhl` and source-field overrides. It is an operational routing authority; `active=true` changes routing even with `deliveryEnabled=false`.
- `SourceFunnel` identifies confirmed origin per LeadCapture page / provider ID and now has optional `leadTypeKey`; confirmation is operational (also impacts inventory origin).
- Exact routing rule tiers outrank confirmed source association; confirmed source outranks loose rule. Existing evidence stays authoritative.
- `ClientOnboardingSetup` is one per client with a single saved requested provider campaign ID; `SourceCampaignAssociationRequest` is an audited per-client request chain, not an operational link. Current guided Source & Campaign UI edits one request at a time.
- `ClientGhlDestination` is unique per client, one shared GHL location and default workflow config.
- `CompanySheetsDestination` is unique per client, one base spreadsheet. `CompanySheetsTabContract` is unique on (destinationId, role): only one `campaign` tab contract per destination. `ClientSheetColumnMap` is already keyed by client/source scope/spreadsheet/worksheet/map version.
- `SourceLeadEvent` persists source campaign ID, resolved client/rule and frozen routing result; #347 snapshots campaign lead type and #349 projects it onto Sheets. Existing event snapshots must not change retroactively.
- Existing one-campaign live clients and all historical delivery receipts must remain unchanged.

## Options evaluated
A. **UI-only grouping of existing SourceFunnels/Rules**: quickest and no migration, but lacks durable campaign identity, source-to-campaign grouping, per-campaign setup requests/readiness and independent operational control. Suitable as a read-only first deliverable, not the final data model.
B. **Additive client campaign registry and phased integration**: recommended. New campaign profile is initially nonoperational, linked to the existing source/routing authorities, then progressively enables deterministic per-campaign delivery selection behind a gate.
C. **Full generalized multi-location/multi-spreadsheet routing**: too large for v1; requires changes to client GHL/Sheets ownership, writer/dispatch contracts and tenant permissions. Defer.

## Proposed additive model — refine before migration
`ClientCampaign`: id, clientAccountId FK, stable slug/label (unique within client), display name, nicheKey, productType, status (draft/review/ready/active/paused/retired), revision, createdAt, updatedAt, actor/audit. Profile is not routing authority and does not arm delivery.

`ClientCampaignSourceBinding`: id, clientCampaignId FK, sourceFunnelId? FK, campaignRoutingRuleId? FK, sourceCampaignId?, sourceProvider?, recorded evidence, status. Require at least one verifiable identity before approval. Several sources may belong to one campaign; a shared source across campaigns needs an additional exact disambiguator and must never silently match both. Resolve conflicting active bindings to REVIEW_REQUIRED.

`ClientCampaignDestinationSelection` (or normalized fields; avoid duplicating existing destination records): optional GHL workflow/trigger and one approved Company Sheets worksheet/map *within the client's existing configured destination*. Keep client-level integration authorization. Do not create duplicate GHL locations/Google connections in v1. Add per-campaign revision and audit; validate selected workflow exists in client location and selected worksheet belongs to verified company spreadsheet.

`SourceLeadEvent.clientCampaignIdResolved` or equivalent immutable routing snapshot only when deterministic and authorized. Do not remap historical events silently. Store both client and campaign evidence for review and reconciliation.

Inspect how current `CampaignRoutingRule`, `SourceFunnel.leadTypeKey` and associated writers overlap before adding any new field. They remain canonical operational authorities; a campaign row is an organizing/configuration layer, never a parallel hidden router.

## Execution phases / PR lanes (small, sequential)
**PR A: read-only campaign inventory and conflicts.** Group existing confirmed SourceFunnels, exact/loose rules, GHL destination and Sheets tabs per client. Show unmatched, multiple source candidates, overlapping identifiers, and missing classification. No migration or writes required.

**PR B: request-only campaign registry.** Add additive tables, audit, idempotent create/update APIs, version checks, one or more proposed source bindings per campaign, nonoperational defaults; persist draft without touching operational SourceFunnel/rules. Gate behind a new exact-true feature flag; migration reviewed separately. Existing client setup request compatibility retained.

**PR C: Team Workspace campaign manager.** Client page -> Campaigns list -> Add campaign -> choose niche/product -> attach source(s) -> select intended GHL workflow and Sheets worksheet -> Save request -> Review. Display pending, configured and delivery-receipt states accurately. No implied activation. Preserve existing single-campaign page and request flows.

**PR D: deterministic runtime resolution (shadow).** Reuse precedence `exact CampaignRoutingRule > confirmed source association > loose rule`; resolve one campaign only from approved source bindings and store frozen identity/classification/selection on the event. No fuzzy name-based ownership. Introduce a routing conflict review state. Explicit route-level Lead Type handling must follow #347 trust rules: only validated operator configuration or trusted `sa360_campaign_lead_type`; no consumer-answer or URL inference. Test same-niche/different-campaign and multi-source cases. Do not execute delivery.

**PR E: per-campaign destination selection.** For GHL, reuse one `ClientGhlDestination` and existing mapping/dispatch authorization; select a validated workflow per campaign and ensure idempotent enrollment per lead/campaign without duplicate contact/opportunity creation. For Sheets, design and migrate beyond the unique (destinationId,role) single `campaign` tab contract, or add a separate campaign-to-worksheet binding, with existing default tab retained for legacy clients. Reuse `ClientSheetColumnMap` per worksheet, published-map versioning, stable row IDs, immutable enqueue snapshots and retry policy (#362/#363). Opt-in fail closed on missing campaign binding; never fall back to a *different campaign's* tab.

**PR F: controlled cutover.** Confirm one multi-campaign demo tenant with distinct VET and NURSE leads and a second VET campaign. Dry-run/shadow compare to existing destinations, then activate only one lane under explicit operator approval, keep independent rollback. Real-world Ray should remain untouched until separately authorized.

## Safety invariants
- No feature flag or delivery switch changes without separate explicit activation approval.
- Creating a client/campaign/draft/source request MUST NOT call `confirmSourceFunnelOrigin`, `reassignSourceFunnelOrigin`, `createRoutingRuleAdmin`, or GHL/Google writers.
- Active routing rule writes can change production routing even when delivery is off; never use as a harmless draft.
- One event must have one deterministic tenant and at most one selected campaign. Ambiguity => review; never wrong-client delivery.
- Preserve immutable historical routing decisions, enrollment/append idempotency, delivery jobs, receipts and GHL/Sheets audit trails.
- Shared-client GHL contact may appear in multiple lead submissions/campaigns; distinguish submission/event attribution from contact identity. No duplicate messages or opportunity creation by default.
- Check each workflow's trigger mode, field requirements, source normalization, Age/DOB projection, and sales-compliance guards before opening live.
- Client-level, campaign-level and destination-level gates all must pass; pause one campaign must not pause others.
- A change to a shared Sheets published map must not overwrite historical jobs or create duplicate appends.
- No source ownership from keyword, display name, niche, client name or URL text; use exact verified identifiers.
- Do not widen PPL resale/eligibility rules as part of this feature.

## Acceptance matrix
1. Existing one-campaign client: no behavior change.
2. One client VET + NURSE: both identify correct campaign and workflow, separate Sheet worksheets.
3. One client two VET campaigns: exact identifiers preserve distinct source/attribution.
4. Multiple source forms feeding one campaign: resolve same campaign without duplicate delivery.
5. Two clients with similar names/UTMs: do not cross-route.
6. Conflicting exact bindings or missing source ownership: review, no external send.
7. No Lead Type / conflicting trusted field: preserve explicit unresolved/conflict semantics.
8. One campaign paused, another active: only paused lane blocked.
9. GHL workflow missing / mapping invalid: block affected lane, preserve others.
10. Sheet headers changed / paused published map: existing refresh, retire, publish, retry guards apply; no double append.
11. Duplicate webhook and repeat phone across campaigns: source-event idempotency and contact-dedupe do not erase original attribution.
12. Old lead history and orders: unchanged; new activation not retroactive.

## Not in v1
Multiple GHL locations per client, multiple spreadsheet destinations per client, pooled lead bidding, campaign budget optimization, automatic historical replays, Meta CAPI redesign, new pricing model, manual lead import redesign, one-click bulk activation.

## Operational rollout
- Start all new config nonoperational and feature flagged.
- Build fixture tests against existing schema and snapshot contracts.
- Read-only inventory first; request-only writes second.
- Do not merge broad changes into master without review of migrations, API, UI, sheets/GHL writers, and concurrency.
- Enable in an isolated demo/client test only after matching shadow decisions and verifying exact target workflow/worksheet.
- Provide a per-campaign pause/rollback, before-state capture, after-readback, and operational cutover receipt.

## PR A outcome and PR B contract

PR A is a read-only inventory. `GET /admin/v1/clients/:clientAccountId/campaign-inventory` groups confirmed sources, suggested sources, and routing rules for one client. The Admin C.O.C. client page shows that inventory. It does not persist a campaign, confirm a source, create a routing rule, or change a delivery flag.

Grouping uses exact identifiers only:

- `campaign_id`, `adset_id`, `ad_id`, and `form_id` on an exact-tier routing rule
- a source `providerFunnelId` or `parentUrlKey` when it equals a `campaign_id`
- a source `providerFunnelId` when it equals a `form_id`

Display names, UTM text, keyword patterns, niche, product, Lead Type, and the client account's niche list are shown and are not join keys. UTM and keyword rules stay in their own candidates. `ClientOnboardingSetup` and the open `SourceCampaignAssociationRequest` are evidence. They are not operational links, and one of each cannot represent every candidate.

`evidenceQuality` describes identity evidence. Destination gaps are separate conflict codes because GoHighLevel and Company Sheets are still one client-level destination. The single `CompanySheetsTabContract` campaign role and the single published `ClientSheetColumnMap` are not assigned to a candidate. Inventory keys are ephemeral strings of source and rule ids. They must not be stored as campaign ids.

Unresolved in PR A, and intentionally left unresolved:

- A quiet candidate's last source event can fall outside the latest 100 matching events, or outside the first 40 exact identifiers. `sourceEventLookupCapped` reports that bound.
- A form id and a provider funnel id join on string equality. They are not checked as the same provider namespace beyond that equality.
- Historical events keep their stored routing snapshot. This read does not reinterpret them.
- Live GoHighLevel workflow existence and live spreadsheet headers are not checked. Only stored rows are shown.

### What PR B must add

PR B is the request-only campaign registry. It needs an Auth/Account migration review. PR A does not authorize that migration.

Persist, additively:

- `ClientCampaign`: client account, stable slug unique per client, display name, niche, product, nonoperational status (`draft`, `review`, `ready`, `active`, `paused`, `retired` stored but not armed), revision, actor, audit.
- `ClientCampaignSourceBinding`: campaign, optional source funnel, optional routing rule, optional exact source campaign id, provider, evidence, status. At least one exact identifier is required before the binding can leave draft: provider funnel id, parent URL key, campaign id, form id, ad set id, or ad id.
- `ClientCampaignDestinationSelection`: optional workflow id and optional worksheet id inside the client's existing `ClientGhlDestination` and `CompanySheetsDestination`. Do not create a second location, spreadsheet, or Google connection. Do not change the unique `(destinationId, role)` campaign tab in PR B. Record the intended worksheet as a nonoperational selection and leave the tab-contract change to PR E.

API behavior:

- Idempotent create and update, with a request id, expected revision, and payload hash, following `SourceCampaignAssociationRequest`.
- Several draft campaigns per client, including two in the same niche and two in different niches.
- A new exact-true feature flag, default off. Off means the existing single-campaign setup and request APIs stay the only write path.
- Keep the current one-row `ClientOnboardingSetup` source fields and the current association-request chain working for clients that do not use the flag.
- Reject a binding whose only evidence is a display name, UTM value, keyword, niche, product, or Lead Type.
- Reject a UTM or keyword rule as the sole binding.
- A suggested source may be named on a draft. Saving the draft must not confirm it.
- The same exact identifier on two campaigns for one client, or on another client, returns a review-required result and does not write a second live binding.
- Creating or editing a draft must not call `confirmSourceFunnelOrigin`, `reassignSourceFunnelOrigin`, `createRoutingRuleAdmin`, or any GoHighLevel, Google, Meta, or delivery writer.
- Do not change routing precedence, `SourceLeadEvent` snapshots, Sheets or GHL writers, payment, orders, or PPL eligibility.
- Do not copy an inventory key from PR A into `ClientCampaign.id`. An operator or a saved request chooses the campaign. The inventory only shows what already exists.

Tests PR B needs before it is reviewable:

- Two drafts in one niche stay distinct.
- Two drafts in different niches stay distinct.
- An overlapping exact id is review-required and writes neither a routing rule nor a source confirmation.
- A legacy client with one setup request is unchanged when the flag is off.
- Draft creation leaves routing-rule count, source confirmation count, and delivery flags unchanged.

## Relevant merged baseline PRs
#302 guided onboarding; #308/#310 source/campaign requests; #322 evidence-driven setup status; #324 client niche/product catalog; #344 stored sources/destinations; #347 Lead Type at intake; #349 Sheets Lead Type projection; #359 DOB/optional Lead Type map; #360 correct cutover allowlist labels; #361 GHL notes; #362/#363 Sheets header recovery.

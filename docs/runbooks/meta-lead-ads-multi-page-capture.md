# Meta Lead Ads — multi-Page capture foundation

Status: **code-ready, default off, not activated.** This runbook does not merge, deploy,
change production settings, subscribe Pages, retrieve production leads, or perform a
production write. Another agent may be doing read-only Page and token discovery. Do not
change that branch or any production Meta setting from this work.

App ID: `1641287293781686`. Verified callback: `/webhooks/meta/leadgen` (alias of
`/sources/facebook/lead-created`). Successful Meta-originated handshake: November 4, 2026.
Canonical identity remains `facebook` / `meta_lead_ads` / `leadgen_id`.

Zapier Facebook capture is unchanged. Capture still does not create inventory, GHL
delivery, company Sheets rows, LF2 reservations, or CAPI dispatch.

## Current architecture

```text
signed leadgen notification
  -> raw SourceLeadEvent retained (existing)
  -> BullMQ meta-leadgen-fetch (only if intake AND graph flags are true)
  -> resolveMetaCapturePageToken
       1. stored MetaPageCaptureGrant for that exact Page, if a row exists
       2. else META_PAGE_ACCESS_TOKEN only when PAGE_ID matches
       3. else the env token only if SA360_META_UNBOUND_PAGE_TOKEN_ENABLED=true
  -> Graph GET /{leadgen-id} with that token only
  -> settleMetaLeadCapture (routing flag false)
       associated only when one confirmed SourceFunnel origin exists
       otherwise admin review, clientAccountIdResolved stays null
```

Global flags stay independent:

| Flag | Default | What it gates |
| --- | --- | --- |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | false | enqueue |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | false | Graph call |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | false | routing / delivery path |
| `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED` | existing Zapier value | Page+Form association writes |
| `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED` | false | legacy "one token for every Page" |
| `SA360_META_CAPTURE_INVENTORY_ENABLED` | false | live Graph discovery |
| `MetaPageCaptureGrant.captureEnabled` | false | that Page's stored token |

`FACEBOOK_DIRECT_INTAKE_ENABLED` is still the legacy alias that turns intake, Graph, **and
routing** on. Do not set it.

## Exact blockers before this change

1. One env token (`META_PAGE_ACCESS_TOKEN`) plus an optional Page binding. A different Page
   failed closed, but there was no way to authorize a second Page without using the unbound
   token for every Page.
2. No encrypted credential store, so a second token could not be rotated without putting it
   in the environment or a source file.
3. No Page-level allowlist, so a future multi-Page token would have turned on every Page at
   once.
4. No read-only inventory that reconciles Pages, forms, ad accounts, and subscriptions with
   `ClientAccount`, `SourceFunnel`, and `CampaignRoutingRule` without creating clients.
5. Admin C.O.C. could show one fetch, but not which Pages were granted or how many leads
   were waiting in admin review.

The unbound env token previously ran for every Page when `META_PAGE_ACCESS_TOKEN_PAGE_ID`
was empty. That path now fails closed unless `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED=true`.
The one-Page pilot still works when `META_PAGE_ACCESS_TOKEN_PAGE_ID` is set to that Page
and no stored grant exists for it. A stored grant for that Page, even with capture off,
wins and blocks the env token. Do not insert a disabled grant for the pilot Page unless
the intent is to pause it.

## Data model

Additive migration `20261104230000_meta_multi_page_capture_foundation`:

- `MetaGraphCredential` — AES-256-GCM ciphertext, fingerprint, version, expiry, scopes, status.
  Key is `META_TOKEN_ENCRYPTION_KEY` only. No fallback to the GHL or Google keys.
- `MetaPageCaptureGrant` — one row per Page, `captureEnabled` default false.
- `MetaFormCandidate` — registry evidence. No foreign key to `ClientAccount`.

No existing column changes. No backfill.

## Admin API

All routes require `x-sa360-admin-key`. Responses omit tokens and ciphertext.

| Method | Path | Effect |
| --- | --- | --- |
| GET | `/admin/v1/meta-capture/health` | Flags, grants, review counts. No Graph call. |
| GET | `/admin/v1/meta-capture/inventory` | Reconcile stored candidates, SourceFunnels, and routing rules. |
| GET | `/admin/v1/meta-capture/inventory?live=1&credentialId=` | Read-only Graph discovery. Requires the inventory flag. |
| POST | `/admin/v1/meta-capture/credentials` | Encrypt a Page or System User token. Grants default off. |
| POST | `/admin/v1/meta-capture/credentials/:id/rotate` | Replace ciphertext and bump `tokenVersion`. |
| POST | `/admin/v1/meta-capture/credentials/:id/pages` | Add a Page to an existing credential. Default capture off. |
| PATCH | `/admin/v1/meta-capture/pages/:pageId` | Toggle `captureEnabled` or reassign the credential. |
| POST | `/admin/v1/meta-capture/candidates` | Upsert candidate evidence. Rejects `clientAccountId`. |

Live discovery reads Pages, lead forms and status, ad accounts and business ids, campaigns,
`subscribed_apps`, and `debug_token`. It does not request lead field data. Pagination stops
on a cursor cap or a rate-limit code and returns the partial result. Missing permission is
reported on that section and does not invent access.

C.O.C. Facebook Intake shows the health summary. It does not store a Page, subscribe a
Page, or match a candidate. That matching screen is still outstanding (see below).

## Security

- Tokens are encrypted before insert and decrypted only inside the API process for Graph.
- Browser responses, logs, and this repo do not contain token values. Logs record Page id,
  credential id, and fingerprint.
- A Page grant never decrypts a different Page's credential.
- Unknown Pages and disabled grants fail closed. The raw signed notification stays on the
  `SourceLeadEvent`.
- Duplicate `leadgen_id` notifications stay one canonical row.
- Unmatched, ambiguous, and identity-missing leads keep `clientAccountIdResolved` null,
  `inventory.saleEligible=false`, and no fulfillment outbox. They are admin review rows,
  not PPL inventory.
- Candidate import cannot create a client or change `SourceFunnel.originClientAccountId`.
- A routing rule match is labeled `routing_rule_present_not_ownership`.

## Production rollout prerequisites

Do all of these before any production flag change. None of them are done by this PR.

1. Merge and deploy this migration with every new flag unset or false.
2. Confirm `FACEBOOK_DIRECT_INTAKE_ENABLED` is unset.
3. Confirm `SA360_META_LEAD_ADS_ROUTING_ENABLED` is false and stays false for capture-only.
4. Confirm `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED` is unset. If production today has
   `META_PAGE_ACCESS_TOKEN` without `META_PAGE_ACCESS_TOKEN_PAGE_ID`, Graph fetch will now
   fail closed until the Page id is bound or a stored grant is enabled.
5. Set `META_TOKEN_ENCRYPTION_KEY` on the API only (32-byte hex or a long random secret).
   Do not reuse `GHL_TOKEN_ENCRYPTION_KEY` or `GOOGLE_TOKEN_ENCRYPTION_KEY`.
6. Keep `META_APP_SECRET` and `META_WEBHOOK_VERIFY_TOKEN` on the API. The worker still has
   no Meta token.
7. App Review / live mode for `leads_retrieval`, `pages_manage_ads`, `pages_read_engagement`,
   `pages_show_list`, and `pages_manage_metadata` must be confirmed for each Page. Do not
   assume the November 4 handshake granted lead retrieval.
8. Business Manager must assign each Page to the system user, or an operator must supply a
   Page token for that Page. Store it through the admin credential route. Do not commit it.
9. Import the sanitized campaign registry as candidates. The copy with 22 form ids across
   five Pages was not in this workspace. Treat that file as evidence, not as proof that
   every Page is a Life Agent Launch asset and not as client ownership.
10. Reconcile `GET /admin/v1/meta-capture/inventory` with existing clients. Create no client
    from that list. Confirm associations only through the existing Facebook Intake
    association endpoint.

## One-Page capture-only activation

Use this only after the prerequisites. It does not subscribe the Page by itself.

1. Bind the existing pilot token: `META_PAGE_ACCESS_TOKEN` and
   `META_PAGE_ACCESS_TOKEN_PAGE_ID` for the one Page already chosen in
   `docs/runbooks/meta-lead-ads-one-page-pilot.md`. Leave stored grants empty for that Page,
   or create one grant with `captureEnabled: true` and no env binding.
2. Confirm the Page+Form association with `POST /admin/v1/facebook-form-associations`
   against the existing `ClientAccount`. A 409 means stop.
3. `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED=true` if the Zapier path is not already on.
4. `SA360_META_LEAD_ADS_INTAKE_ENABLED=true` and `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED=true`.
5. Leave routing, the unbound token flag, and live discovery false.
6. Subscribe only that Page to `leadgen`, then send one test lead.
7. Expect one Source Intake row: capture only, source client set, delivery destination none,
   inventory not tracked, Graph `tokenSource` `env_page` or `stored_page`.

## Batch rollout

1. Store the System User token or one Page token per Page. Every new grant stays
   `captureEnabled: false`.
2. Run live discovery only after `SA360_META_CAPTURE_INVENTORY_ENABLED=true`, read the
   reconciliation, then turn the flag off again if it is not needed.
3. For each batch, confirm a Page+Form association only when one client owns that form.
   When reconciliation shows `sharedAcrossCampaigns: true`, leave the leads
   unmatched. Page + Form is not a client identity for a form used by more than
   one campaign. The later Resolve Source workflow records the campaign-scoped
   confirmation. Leave every other form as a candidate.
4. `PATCH /admin/v1/meta-capture/pages/:pageId` with `{ "captureEnabled": true }` for that
   batch only.
5. Watch Facebook Intake health: `captureNotAllowlisted` should drop for that Page, and
   admin-review unmatched should rise only for forms that are still unconfirmed.
6. Do not enable routing. Do not enroll inventory.

## Rollback

1. `PATCH` the Page grant to `{ "captureEnabled": false }`, or set
   `SA360_META_LEAD_ADS_INTAKE_ENABLED=false`. Signed notifications are still stored. Jobs
   already queued finish as `flags_disabled` or `capture_not_allowlisted` and keep the raw
   payload. Requeue after the grant is on again.
2. Unsubscribe the Page with `DELETE /{page-id}/subscribed_apps` when an operator is
   authorized to change Meta. This repo does not perform that call.
3. Rotate or stop using a token with `POST .../rotate` or by setting credential status
   through a later admin action. Disabling the grant is enough to stop Graph calls.
4. Do not delete `SourceLeadEvent` rows as a rollback. Do not turn off Zapier capture to
   roll back Meta.

## One-Click Resolve Source — contract for the next agent

Do not implement this workflow in the capture foundation. Capture records the
facts the later workflow needs and leaves confirmation to an operator.

What this foundation already preserves on every settled Meta and Zapier
capture-only event:

- Stable identity: `sourceProvider=facebook`, `sourceSystem=meta_lead_ads`,
  `sourceLeadId` = the Meta lead id, and `sourceLeadUid` =
  `facebook-meta_lead_ads-{leadgenId}`. The event id does not change when a
  client is confirmed later.
- Page, Form, campaign, campaign name, ad set, ad, ad group, and ad account ids
  on `normalizedPayload.source` when the webhook or Graph returned them.
- UTM fields and the original form answers on `normalizedPayload.custom_fields`.
- Explicit association outcome on `enrichment.association`. Unmatched is
  `unassociated`. Two confirmed owners of the same Page + Form are `ambiguous`.
  Missing or non-numeric ids are `missing_form_identity` or
  `invalid_form_identity`.
- A capture-time `enrichment.resolveSource` object, contract version 1. It
  copies those ids, records `pageFormIdentifiesOneClient: false`, and records
  `implemented: false`. It does not resolve a client.
- Existing `ClientAccount` and `SourceFunnel` rows. Confirmed ownership is still
  `SourceFunnel.originClientAccountId` with
  `providerFunnelId=fbpage:{pageId}:fbform:{formId}`. Suggested clients and
  routing rules are not ownership. Candidate import does not create a client
  and does not overwrite that origin.

A confirmed Page + Form association remains compatible with capture today. It
is not proof that every campaign on that form belongs to the same client.
Reconciliation reports `campaignIds`, `sharedAcrossCampaigns`, and
`pageFormIdentifiesOneClient: false`. Two Pages that happen to use the same
Form ID stay two rows.

### Eligibility the next workflow must reuse

`POST /admin/v1/facebook-capture/events/:sourceEventId/reevaluate-association`
already re-reads the current Page + Form association for a settled capture-only
event. It accepts both Meta-originated and Zapier-originated rows because both
use `sourceSystem=meta_lead_ads`. It does not call Graph, does not recapture
the lead, and its response sets `delivery.thisRequestAttempted` to false and
`inventory.mutated` to false.

It refuses, and the next workflow must keep refusing:

- events that are not settled capture-only Facebook events
- statuses `delivered`, `approved`, `delivery_failed`, and `rejected`
- any row with `deliveredAt`, `approvedAt`, a fulfillment outbox item, a lead
  allocation, or a `LeadInventoryItem`

A historical lead that later matches a client must stay in its capture-only
status. Matching must not enqueue GHL, company Sheets, LF2, CAPI, or inventory.

### Recommended API, not implemented here

```http
POST /admin/v1/facebook-capture/events/:sourceEventId/resolve-source
```

Admin key required, same as the other `/admin/v1` routes. Recommended body:

```json
{
  "clientAccountId": "existing ClientAccount id",
  "scope": "page_form_campaign",
  "campaignId": "required when scope is page_form_campaign",
  "acknowledgeSharedForm": false,
  "operatorNote": "optional"
}
```

`scope` is `page_form` or `page_form_campaign`.

Required behavior:

- 404 when the event or the client does not exist. Never create a client.
- 409 for the same ineligible rows the current reevaluate endpoint rejects.
- 409 when `scope` is `page_form` and the stored lead or the reconciliation
  shows more than one campaign for that Page + Form, unless the operator sends
  `acknowledgeSharedForm: true`. The default for a shared form is campaign
  scope, not a form-wide claim.
- 409 when campaign scope omits `campaignId`, or when that id does not match
  the campaign stored on the lead being confirmed.
- Confirming one campaign must not rewrite another campaign's client, and must
  not overwrite a different confirmed `SourceFunnel` origin.
- Write the event the way reevaluate already does: set
  `clientAccountIdResolved`, replace `enrichment.association`, and append
  `associationAudit`. Leave `resolveSource` as the capture-time snapshot.
- Do not call Graph, routing, GHL, Sheets, CAPI, LF2, or inventory. Do not
  change `rawPayloadJson` or the leadgen id.
- A repeated confirmation of the same client, scope, and campaign returns
  unchanged.

`GET /admin/v1/facebook-capture/events/:sourceEventId/resolve-source` can return
the stored `resolveSource` object plus the current association and the
reconciliation row for that Page + Form. It must stay read-only.

### Schema the next agent should add, not this PR

Do not change the existing SourceFunnel unique key. A later additive table is
the safer place for campaign-scoped confirmation:

```text
MetaSourceResolution
  sourceLeadEventId
  pageId, formId, campaignId nullable
  clientAccountId  -> existing ClientAccount, restrict on delete
  scope            form_wide | campaign
  confirmedAt
  actor, operatorNote
  unique (pageId, formId, campaignId) with empty campaignId meaning form-wide
```

Form-wide confirmation may also write the existing SourceFunnel origin, and
only when no other origin is stored. Campaign confirmation writes
`MetaSourceResolution` and the single event. It does not write a Page + Form
origin that would claim every campaign. The capture resolver keeps reading the
Page + Form key until a later change explicitly teaches it to prefer a
campaign row and then fall back to the form-wide row.

No migration for that table is in this foundation. Settled events do not need
to be rewritten; their ids and answers are already on the row.

## Operator matching UI still outstanding

Facebook Intake can record one confirmed Page ID + Form ID association and can show capture
health. It does not yet:

- list unmatched `meta_lead_ads` rows beside candidate evidence
- accept or reject a candidate without typing ids
- show ad account, campaign, and subscription diffs from the last discovery
- warn when a routing rule names a client the SourceFunnel does not confirm
- bulk-enable a reviewed batch of Page grants

Until that screen exists, operators use `GET /admin/v1/meta-capture/inventory` and the
existing association form. Unmatched leads remain admin-only and are not delivered.

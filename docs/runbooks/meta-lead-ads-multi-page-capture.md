# Meta Lead Ads — multi-Page capture foundation

Status: **code-ready, default off, not activated.** This runbook does not merge, deploy,
change production settings, retrieve production leads, or perform a production write.
The eight-Page leadgen subscription section below is the operator procedure for a later
approved change. It is not executed by the change that added the routes. Do not change
any production Meta setting from this document alone.

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
  -> resolveMetaCapturePageToken (no Graph call)
       1. stored MetaPageCaptureGrant for that exact Page, if a row exists
          captureEnabled false fails closed and does not fall through
       2. else META_PAGE_ACCESS_TOKEN only when PAGE_ID matches
       3. else the env token only if SA360_META_UNBOUND_PAGE_TOKEN_ENABLED=true
  -> if the stored credential kind is system_user:
       GET /me/accounts?fields=id,name,tasks,access_token
       use the access_token on the row whose id equals this Page
       a missing row or a missing access_token does not call the lead endpoint
       another Page's access_token is never substituted
     page_access_token credentials and the env Page token are used as stored
  -> Graph GET /{leadgen-id} with that Page token only
  -> settleMetaLeadCapture (routing flag false)
       associated only when one confirmed SourceFunnel origin exists
       otherwise admin review, clientAccountIdResolved stays null
```

Live discovery uses the same exchange for `/{page-id}/leadgen_forms` and
`/{page-id}/subscribed_apps`. `/me/accounts`, `/me/adaccounts`, and `debug_token`
still use the system user token. Page tokens are held in memory for that call
and are not stored, logged, or returned.

Global flags stay independent:

| Flag | Default | What it gates |
| --- | --- | --- |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | false | enqueue |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | false | Graph call |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | false | routing / delivery path |
| `SA360_FACEBOOK_CAPTURE_INTAKE_ENABLED` | existing Zapier value | Page+Form association writes |
| `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED` | false | legacy "one token for every Page" |
| `SA360_META_CAPTURE_INVENTORY_ENABLED` | false | live Graph discovery |
| `SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED` | false | one confirmed Page `subscribed_apps` POST |
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

`20261106010000_meta_capture_sa360_app_grants` grants `sa360_app` `SELECT`,
`INSERT`, `UPDATE`, and `DELETE` on those three tables. PostgreSQL default
privileges do not grant new tables to `sa360_app`. The migration does not set
`ALTER DEFAULT PRIVILEGES`. Production `prisma migrate deploy` runs as
`doadmin`, which owns the tables. The API uses `sa360_app` only where that
login is already the runtime role. `META_TOKEN_ENCRYPTION_KEY` can stay unset
on the first deploy: credential writes return `encryption_not_configured`, and
the global capture flags stay false unless an operator sets them.

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
| GET | `/admin/v1/meta-capture/credentials/:credentialId/leadgen-subscriptions` | Read `subscribed_apps` for every grant on that system-user credential. Does not subscribe. |
| POST | `/admin/v1/meta-capture/credentials/:credentialId/pages/:pageId/subscribe-leadgen` | Subscribe that one granted Page to `leadgen` after an exact confirmation. Writes flag required. |

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

## Pilot Page isolation

The current pilot Page is authorized by `META_PAGE_ACCESS_TOKEN` plus
`META_PAGE_ACCESS_TOKEN_PAGE_ID`. That env token is used only when a notification
Page id equals that bound id **and** that Page has no `MetaPageCaptureGrant` row.
Enabling a different Page's grant does not select the pilot token for the test
Page, and it does not by itself turn the global flags on.

Turning `SA360_META_LEAD_ADS_INTAKE_ENABLED` and
`SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` on while the pilot has no grant **does**
queue and fetch the pilot through that env-token path. A disabled grant is the
switch that suppresses it. A stored grant is authoritative: `captureEnabled: false`
does not fall through to the env token, and the webhook does not enqueue Graph.

Set this configuration before any test Page is allowed to fetch:

| Variable | Required value |
| --- | --- |
| `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED` | unset or `false` |
| `FACEBOOK_DIRECT_INTAKE_ENABLED` | unset |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | `false` |
| `META_PAGE_ACCESS_TOKEN_PAGE_ID` | the pilot Page id |
| Pilot `MetaPageCaptureGrant.captureEnabled` | `false` |
| Test Page `MetaPageCaptureGrant.captureEnabled` | `true`, on its own credential |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | `true` only after the pilot grant exists |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | `true` only after the pilot grant exists |

Order:

1. Leave both global flags false. If they were already true, set them false and
   wait until queued jobs finish as `flags_disabled`. A job already running
   checks the flags before Graph.
2. Store a credential whose only pilot Page grant is `captureEnabled: false`.
   The stored ciphertext is not used while the grant is off. Do not omit this
   row. With no row, the bound env token is the fallback and the pilot fetches.
3. Store the test Page on a different credential with `captureEnabled: true`.
4. Then set the intake and Graph flags true.

After that, a pilot notification is retained with `tokenBlockReason`
`capture_not_allowlisted` and is not queued. A test-Page notification queues
with `tokenSource` `stored_page`. `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED=true`
would authorize an unbound env token for every Page that has no grant. Leave
it false.

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

## Eight-Page leadgen subscription rollout

This procedure subscribes the SA360 app to `leadgen` on the eight Pages already
granted to system-user credential `cmwl1r7hv001aiv0ujzbt0zjp`. It does not enable
capture, intake, Graph lead fetch, routing, GHL, Sheets, CAPI, or Zapier changes.
Run it only after a separate operator approval. The code change that added these
routes does not call Graph and does not set the writes flag.

Leave these values false or unset for the whole procedure:

| Variable | Required value |
| --- | --- |
| `SA360_META_LEAD_ADS_INTAKE_ENABLED` | false or unset |
| `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED` | false or unset |
| `SA360_META_LEAD_ADS_ROUTING_ENABLED` | false or unset |
| `FACEBOOK_DIRECT_INTAKE_ENABLED` | unset |
| `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED` | false or unset |
| `SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED` | false until step 3, then false again after each Page |
| Every `MetaPageCaptureGrant.captureEnabled` | false |

`GET /admin/v1/meta-capture/health` should still show credential
`cmwl1r7hv001aiv0ujzbt0zjp` as `kind: system_user`, app id `1641287293781686`,
and eight grants with `captureEnabled: false`. `META_APP_SECRET` stays set. If
`META_APP_ID` is set, it must be `1641287293781686`.

The API resolves a Page token by reading `/me/accounts` with the stored
system-user token and selecting the row whose id is exactly that Page. It
sends that Page token only to `/{page-id}/subscribed_apps`. A missing row, a
token shared by two Pages, or a failed `debug_token` app-id check stops the
call. Responses and logs contain Page ids, the action, the result, and a
redacted diagnostic. They do not contain access tokens.

`debug_token` must show `pages_show_list` and `pages_manage_metadata` on this
credential before any Page endpoint is called. When the stored `scopes` list
is non-empty and omits either permission, the route returns
`missing_permission` and does not call Graph. An empty `scopes` list skips
that stored check and uses `debug_token`. Update the stored scopes if they
were recorded before these two permissions were granted. Do not put a token
in that update.

1. With the writes flag still false, call:

   ```http
   GET /admin/v1/meta-capture/credentials/cmwl1r7hv001aiv0ujzbt0zjp/leadgen-subscriptions
   x-sa360-admin-key: <admin key>
   ```

   Expect eight Page rows. `captureGrantMutated` is false and every
   `captureEnabled` is false. `sa360LeadgenSubscribed` is true or false only
   when `subscriptionKnown` is true. A null value means that Page was not
   read; do not treat it as unsubscribed. `partial: true` means at least one
   Page was not read. Stop if `appIdVerified` is not true, if the credential
   is not the system-user credential above, or if any grant is enabled.
   Record the eight Page ids and which ones already show `leadgen` on app
   `1641287293781686`. Other apps and their `subscribedFields` are the
   baseline that a later POST must leave unchanged.

2. Choose one Page from that list. Prefer Page `222591640945329` when it is
   one of the eight and `subscriptionKnown` is true. Leave the other seven
   untouched.

3. Set `SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED=true` on the API only
   and restart it. Confirm the intake, Graph-fetch, routing, and
   `FACEBOOK_DIRECT_INTAKE_ENABLED` values in the table above are still off.
   The POST is rejected with `production_unsafe` when any of those is true,
   and with `writes_disabled` when the writes flag is false.

4. Subscribe that one Page. The confirmation text is the Page id, so a body
   copied from another Page is rejected:

   ```http
   POST /admin/v1/meta-capture/credentials/cmwl1r7hv001aiv0ujzbt0zjp/pages/<page-id>/subscribe-leadgen
   x-sa360-admin-key: <admin key>

   { "confirmed": true, "confirmationText": "SUBSCRIBE LEADGEN <page-id>" }
   ```

   The API reads `subscribed_apps` first. When app `1641287293781686` already
   has `leadgen`, the result is `already_subscribed`, `postSent: false`, and
   no POST is sent. Otherwise it POSTs
   `subscribed_fields` as that app's current fields plus `leadgen`. Fields
   that belong to other apps are not sent. Success requires `verifiedByGet:
   true` from a new GET after the POST. A POST body of `{ "success": true }`
   is not a successful subscription. `captureEnabled` in the response stays
   false, and `captureGrantMutated` stays false.

5. Repeat the GET from step 1. The chosen Page shows `sa360LeadgenSubscribed:
   true` with its previous SA360 fields still present. The other seven Pages
   match the step 1 baseline. Every grant is still disabled. The JSON still
   has no access token.

6. Set `SA360_META_LEADGEN_SUBSCRIPTION_WRITES_ENABLED=false` and restart the
   API before doing anything else.

7. For each of the remaining seven Pages, repeat steps 3 through 6 one Page
   at a time. Read the subscription list after each Page. If a Page returns
   `page_token_missing`, `missing_permission`, `wrong_app_id`, `rate_limited`,
   `verification_failed`, or `partial` on the following GET, stop. Do not
   continue to the next Page and do not send that Page's POST again until a
   fresh GET shows whether `leadgen` is already present. A second POST is
   skipped when `leadgen` is already on the SA360 app. A verification failure
   can mean an earlier SA360 field was dropped; inspect the GET before
   retrying, because a later call will not POST once `leadgen` is present.

8. After all eight reads agree, leave the writes flag false. Leave intake,
   Graph fetch, routing, `FACEBOOK_DIRECT_INTAKE_ENABLED`, and all eight
   `captureEnabled` values false. Subscription makes Meta able to call the
   existing leadgen webhook. It does not enqueue fetch, route a lead, or
   deliver one. Zapier Facebook capture is unchanged.

The route does not call `DELETE /{page-id}/subscribed_apps` and does not edit
another app's subscription. Unsubscribing remains an authorized operator call
outside this repo, as described in Rollback.

## Rollback

1. `PATCH` the Page grant to `{ "captureEnabled": false }`, or set
   `SA360_META_LEAD_ADS_INTAKE_ENABLED=false`. Signed notifications are still stored. Jobs
   already queued finish as `flags_disabled` or `capture_not_allowlisted` and keep the raw
   payload. Requeue after the grant is on again.
2. Unsubscribe the Page with `DELETE /{page-id}/subscribed_apps` when an operator is
   authorized to change Meta. The leadgen subscription route does not perform that call
   and does not edit another app's subscribed fields.
3. Rotate or stop using a token with `POST .../rotate` or by setting credential status
   through a later admin action. Disabling the grant is enough to stop Graph calls.
4. Do not delete `SourceLeadEvent` rows as a rollback. Do not turn off Zapier capture to
   roll back Meta.

## Read-only check after the system-user Page token fix

Do not rotate the production token, subscribe a Page, fetch a lead, or turn on
intake, Graph fetch, routing, or delivery as part of verifying this change.
`GET /admin/v1/meta-capture/health` does not call Graph.

1. Confirm `SA360_META_LEAD_ADS_INTAKE_ENABLED`, `SA360_META_LEAD_ADS_GRAPH_FETCH_ENABLED`,
   `SA360_META_LEAD_ADS_ROUTING_ENABLED`, `SA360_META_UNBOUND_PAGE_TOKEN_ENABLED`, and
   `FACEBOOK_DIRECT_INTAKE_ENABLED` are unset or false.
2. `GET /admin/v1/meta-capture/health` with `x-sa360-admin-key`. The credential
   `cmwl1r7hv001aiv0ujzbt0zjp` should be `kind: system_user`, app id
   `1641287293781686`, and every Page grant `captureEnabled: false`. The JSON
   must not contain an access token or ciphertext.
3. Leave Zapier Facebook capture unchanged.
4. Optional later read, still with intake and Graph fetch off: set
   `SA360_META_CAPTURE_INVENTORY_ENABLED=true` only for the request, then
   `GET /admin/v1/meta-capture/inventory?live=1&credentialId=cmwl1r7hv001aiv0ujzbt0zjp`.
   That calls `/me/accounts` with the system user token and calls
   `leadgen_forms` and `subscribed_apps` with the Page token for
   `222591640945329` only. It does not call `GET /{leadgen-id}` and it does not
   subscribe the Page. Turn the inventory flag off again when the read is done.
   A remaining OAuth 190 on those Page endpoints is a Page-token permission
   problem, not the system user token being sent to the Page. The response
   must still omit every token.

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

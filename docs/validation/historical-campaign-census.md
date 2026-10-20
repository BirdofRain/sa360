# Historical campaign census and reserved-order drill-down

Read-only operator views for historical `manual_import` / `csv_import` inventory and one order. Policy ids:

- Census: `historical-campaign-census-v1`
- Provenance classification: `ppl-provenance-eligibility-v1`, with verified-acquisition evidence passed as `NULL::text`
- Revised reservation classification, reported only: `historical-campaign-recovery-v1`

This change does not stamp `originClientAccountId`, confirm resale, select inventory, release an allocation, export a file, cancel an order, or merge PR #188. PR #188 stays on HOLD.

A completed response is a finished read-only snapshot. `measurement.operatorVerifiedProduction` stays `false`. The API does not treat `NODE_ENV` or any other environment label as proof of production. Admin C.O.C. can record an operator click for the PostgreSQL identity shown on that snapshot. The click stays in the browser and does not change the API payload.

July `sourceCampaignName` is the original attribution. The census classifies it and does not return the text. A later workbook value in `normalizedPayloadJson.campaign_name` or `rawPayloadJson.master.lead_type` can mark a row conflicting or post-July. It does not replace the July column. A client display name that resembles a label is not ownership.

## Routes

Both routes are off unless `SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED` is the exact string `true`. Any other value, including unset, returns `404` with `code: historical_campaign_census_disabled` and does not open a database transaction. The body has no counts.

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/admin/v1/fulfillment-ops/historical-campaign-census` | One aggregate snapshot of historical inventory |
| GET | `/admin/v1/fulfillment-ops/historical-campaign-orders/:orderNumber` | One order, for example `LO-1053` |

No query string. Any query parameter returns `400`. The order number must match `^[A-Z0-9][A-Z0-9-]{1,31}$`. Anything else returns `400` `historical_order_number_invalid` before a query. A well-formed number that is absent returns `404` `historical_order_not_found` with no allocation totals.

Authentication is the existing operator header `x-sa360-admin-key` (`ADMIN_API_KEY` or `SA360_ADMIN_KEY`). The provenance audit header `x-sa360-provenance-audit-key` and `SA360_AUDIT_READONLY_KEY` do not authorize these routes. Admin C.O.C. sends the existing server-side admin key. Do not put either key in a `NEXT_PUBLIC_` variable.

The association paths below are a contract only. They are not registered. POST to them is `404`.

## What the census counts

One `REPEATABLE READ` `READ ONLY` transaction. `statement_timeout` is 120 seconds. The historical set is materialized once: event `sourceSystem = csv_import`, or event or item `sourceProvider = manual_import`. LeadCapture-only rows stay outside the census. They can still appear on an order as outside the historical gate.

The response groups counts by niche, lot, niche and lot, import request (`rawPayloadJson.importRequestId`, then `bulkImportId`, else `(none)`), original-label agreement, and inventory status. It also returns:

- distinct original July labels, and how many labels fall in the size buckets 1, 2–10, 11–100, 101–1,000, and more than 1,000, plus the largest label's row count
- unresolved-origin rows and rows that already have `originClientAccountId`
- consistent, missing, and conflicting attribution
- open allocations on those historical rows, by status
- stamped origin client account ids and their row counts

Label text, contact fields, customer names, CSV bytes, and raw payloads are not selected into the response. Because verified acquisition is null, unresolved-origin rows plus already-stamped rows equal the historical row count. If a group list would exceed 500 keys, or any total does not reconcile, the route returns `503` `historical_campaign_census_unavailable` and no numeric totals.

A second census request while one snapshot is open returns `503` with reason `census_already_running` and no totals. It does not start another scan. A timeout, snapshot failure, or unsafe response does the same. A completed snapshot of an empty historical set can contain zeros. A failure cannot.

## What the order drill-down counts

Separate `READ ONLY` snapshot. `statement_timeout` is 20 seconds. The order number is a bound parameter. The response includes:

- allocation counts by status, provenance code, and lot
- buyer `clientAccountId`
- whether a confirmed origin equals that buyer, is another client, or is unstamped
- export package counts, spreadsheet-delivered package counts, notify status counts, and delivery-instruction status counts
- replacement request counts by status
- reserved rows that the revised policy would block: unresolved origin, same origin, waiting on resale authorization, outside the historical gate, or missing inventory

`resaleAuthorizationPersisted` is false. No resale table exists, so a stamped historical reservation whose origin is a different client is `would_block_until_resale_authorization`. The drill-down does not change that reservation.

Contact fields, label text, CSV content, replacement reasons, and `clientDisplayName` are not selected. A failure returns `503` `historical_order_drilldown_unavailable` and no allocation totals.

## Admin C.O.C.

`/fulfillment-ops` shows three blocks under Inventory Provenance Impact:

1. Historical campaign census. The first paint does not call the census. **Run read-only census** reloads with `?historicalCensus=1`.
2. Reserved order drill-down. The input defaults to `LO-1053` and does not query until **Open read-only drill-down**.
3. Historical campaign association. The contract is visible. There is no confirm button.

Disabled, idle, unavailable, and not-found states do not show inventory or allocation totals. Observers are not allowed on `/fulfillment-ops` or these BFF routes. A customer portal session does not open them.

BFF routes, both operator-only:

- `GET /api/fulfillment-ops/historical-campaign-census`
- `GET /api/fulfillment-ops/historical-campaign-orders/:orderNumber`

The BFF calls the API with the server admin key only.

## Association contract

Contract id `historical-campaign-association-v1`. Source of truth: `apps/api/src/services/ppl-fulfillment/historical-campaign-association-contract.ts`. The ownership-preview route is registered behind `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` exact `true`, default off, admin key only. That flag is separate from the census flag. Confirmation and resale routes stay unregistered. See `docs/validation/historical-campaign-ownership-preview.md`.

| Route | Writes inventory | Confirms ownership | Confirms resale |
| --- | --- | --- | --- |
| `POST /admin/v1/historical-campaign-associations/ownership-previews` | no | no | no |
| `POST /admin/v1/historical-campaign-associations/ownership-confirmations` | yes, later | yes, later | no |
| `POST /admin/v1/historical-campaign-associations/ownership-reassignments` | yes, later | yes, later | no |
| `POST /admin/v1/historical-campaign-resale/previews` | no | no | no |
| `POST /admin/v1/historical-campaign-resale/confirmations` | no | no | yes, later |

Scope is `inventory_lot` or `import_request`. One client can own many labels in a scope. One label in one scope has one confirmed client. The same text in another import is a different identity. Ambiguous or conflicting proposals stay unstamped. Preview responses keep `stampApplied: false` and `resaleAuthorizationApplied: false`. `clientNameMatchEstablishesOwnership` stays false. Resale preview keeps `labelAcceptedAsEvidence`, `exclusivityAcceptedAsEvidence`, and `usedByAcceptedAsEvidence` false.

Confirmation phrases reserved for the later PR:

- `CONFIRM HISTORICAL CAMPAIGN OWNERSHIP`
- `REASSIGN HISTORICAL CAMPAIGN OWNERSHIP`
- `CONFIRM HISTORICAL RESALE AUTHORIZATION`

## Enable

Set variables on the **API** app only. Do not set them on Admin C.O.C. Do not create `NEXT_PUBLIC_SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED`.

| Variable | Required to enable | Value |
| --- | --- | --- |
| `SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED` | Yes | Exact `true`. Anything else keeps both routes at `404`. |
| `ADMIN_API_KEY` or `SA360_ADMIN_KEY` | Already required | Existing admin credential. Do not rotate it for this census. |
| `SA360_AUDIT_READONLY_KEY` | No | Not used. Do not send it to these routes. |

1. Deploy this API and Admin C.O.C. change with the census flag unset.
2. Request `GET /admin/v1/fulfillment-ops/historical-campaign-census` and confirm `404` `historical_campaign_census_disabled`.
3. Set `SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED=true` on the API app only and restart that app.
4. Open `/fulfillment-ops` as an operator and run the census once. Require `ok: true`, `complete: true`, and `measurement.readOnlySnapshot: complete`.
5. Compare `measurement.databaseIdentity` with the database you intended. Use the on-page verification only after that comparison. The server value stays false.
6. Submit `LO-1053` for the drill-down. Require the same complete snapshot fields, the buyer client account id, and reserved-policy counts.
7. A `503` with `complete: false` is not a zero result. Do not stamp ownership or merge PR #188 from a failed snapshot.

No migration, database role, or inventory write is required. Enabling the flag does not deploy PR #188 and does not change selection, export, release, or replacement.

## Disable and rollback

1. Unset `SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED`, or set it to any value other than `true`, on the API app.
2. Restart the API.
3. Confirm both routes return `404` `historical_campaign_census_disabled`.
4. Admin C.O.C. returns to the idle or disabled panel with no totals after the next request.
5. There is no migration to roll back and no inventory, allocation, order, or lead row to revert. The transactions are `READ ONLY`.
6. Reverting this code removes the routes. PR #188 is a separate change.

## Local checks

Use the local API and a local Admin C.O.C. pointed at it. Use the local disposable database. Do not point this check at production.

1. Leave the census flag unset. Restart the API. Sign in as an operator. Open `/fulfillment-ops`.
2. Confirm the census says it is not loaded and shows no historical-row total. The order field shows `LO-1053` and shows no allocation total.
3. Run the census. With the flag still unset, the panel says the census is off and still shows no totals.
4. An observer cannot open `/fulfillment-ops`. `GET /api/fulfillment-ops/historical-campaign-census` returns `403`.
5. A portal session on `/fulfillment-ops` redirects to `/login`.
6. To see local counts, set the flag on the local API only, restart it, and run the census again.
7. Unset the flag and restart. The next run returns to the disabled state.

Direct local API checks:

- Flag unset, with or without a valid admin key or the audit key: `404` `historical_campaign_census_disabled`.
- Flag on, audit key on either route: `401`.
- Flag on, audit key presented as `x-sa360-admin-key`: `401`.
- Flag on, `?label=secret` or any other query: `400`.
- Flag on, `lo-1053`: `400`.
- POST to the census path or any association path: `404`.
- The audit key on selection commit, release, orders, bootstrap, and provenance impact: `401`.

## Registry schema

The Auth/Account registry migration is `20261019220000_historical_ownership_resale_registry_v1`. Behavior, overlap rules, security, and rollback are in `docs/development/historical-ownership-resale-registry.md`.

The census still passes verified-acquisition evidence as `NULL::text`. It does not read the new tables. PR #188 stays on HOLD. A later ownership-confirmation PR may stamp `originClientAccountId` only where it is still null, the July label still matches, and `historical_campaign_ownership_decision` returns `eligible`. A later resale-confirmation PR writes `HistoricalResaleAuthorization` only. It does not stamp origin and it does not use `verifiedAcquisitionEvidenceId`.

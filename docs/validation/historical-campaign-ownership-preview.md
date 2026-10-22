# Historical campaign ownership preview

Read-only operator workbench for July campaign labels. It does not confirm ownership, insert registry rows, stamp `originClientAccountId`, or change allocations.

Production baseline for this work is `ab14725`. PR #188 stays on HOLD.

## Flag

`SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` must be the exact string `true`. Any other value, including unset, returns `404 historical_campaign_association_disabled` before authentication.

The flag belongs on the API process only. Do not set `NEXT_PUBLIC_SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED`. Do not turn on `SA360_HISTORICAL_CAMPAIGN_CENSUS_ENABLED` as part of this workbench. The census remains a separate, heavier snapshot.

Default is off. A merge does not enable the flag.

## Routes

Operator admin key `x-sa360-admin-key` only. The provenance audit credential is not accepted. Observers and customer portal sessions are denied.

| Route | Effect |
| --- | --- |
| `POST /admin/v1/fulfillment-ops/historical-campaign-catalog` | One scoped, paginated catalog. Requires `lotKey` or `importRequest`. |
| `POST /admin/v1/historical-campaign-associations/ownership-previews` | Read-only preview for explicit campaigns, a single-scope proposal, or a mapping CSV. |

These routes are not registered:

- `POST /admin/v1/historical-campaign-associations/ownership-confirmations`
- `POST /admin/v1/historical-campaign-associations/ownership-reassignments`
- `POST /admin/v1/historical-campaign-resale/previews`
- `POST /admin/v1/historical-campaign-resale/confirmations`

There is no working Confirm Ownership control in Admin C.O.C.

Labels and mapping files are request bodies, not query strings. A query string is rejected. Route logs are silent. Do not add campaign labels, mapping text, or customer contact fields to logs.

## What a search returns

The catalog identity is inventory lot + import request + July `sourceCampaignName` after trim and internal-whitespace collapse. Case stays significant. The same label in another import is a different campaign.

The displayed label is a preserved July value. Later workbook `campaign_name` and `rawPayloadJson.master.lead_type` can mark a conflict. They do not replace the July column.

Rows with no July label are not campaigns. They are counted as missing attribution for the selected scope.

The catalog calls `historical_campaign_ownership_decision` for the page. An empty registry returns `no_coverage`. That is a real persisted result, not an error.

## What a preview returns

Persisted eligibility is only the SQL function result. `originClientAccountId` is present there only when `decision` is `eligible`.

Hypothetical eligibility is computed in memory. It is labeled `hypothetical_not_persisted`. Confirming a preview would project absent, unassigned, or suggested aliases to the proposed client. Conflicted aliases, retired aliases, and aliases confirmed to a different client stay `not_eligible` with `confirmation_would_be_rejected` or `existing_other_origin`. The preview does not insert a temporary alias, including inside a transaction that would roll back.

Every proposal is `UNVERIFIED`. `stampApplied`, `resaleAuthorizationApplied`, `registryRowsWritten`, and `inventoryRowsWritten` are false.

`unlabeledRowsInSelectedScopes` counts July-blank rows in the selected lot and import pairs once. Those rows are not assigned to the named campaign, so a proposal's `missingLabelRows` stays 0. Conflicting later workbook labels stay on the matched campaign as `conflictingLabelRows`.

`LO-1053` reserved allocations on selected rows are counted. The preview does not release, deliver, export, cancel, or modify them.

Candidate original-client exclusion is a count of matched rows that would become ineligible for the proposed client as a buyer if a later confirmation stamped a null origin. Selection code is unchanged.

## Enable

1. Confirm API health still reports the intended commit.
2. Set `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED=true` on `sa360-api` only.
3. Deploy that spec change through the normal App Platform path. This PR adds no migration. The existing PRE_DEPLOY migrate job should report no pending migrations.
4. Sign in to Admin C.O.C. as an operator and open Fulfillment Operations.
5. Search one known lot only after the catalog query starts from `InventoryLot.lotKey` and aggregates origin counts in the same grouping pass. The statement timeout stays 20 seconds. A timeout is a cancelled read, not a reason to raise it or scan the lot again.
6. Preview with an existing ClientAccount. Expect `UNVERIFIED`, `no_coverage` while the registry is empty, and a LO-1053 warning only when the selection includes those reserved rows.

## Roll back

1. Remove `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` from `sa360-api`, or set it to any value other than exact `true`.
2. Deploy that spec change.
3. Both workbench routes return `404 historical_campaign_association_disabled`.
4. There is no migration to reverse and no inventory or allocation row to restore.
5. Confirmation routes were never registered, so they stay Fastify 404.

## Handoff for the confirmation PR

That PR may register ownership confirmation. It must not treat this hypothetical helper as the write gate.

For each proposal:

1. Resolve the lot key and the import key the same way this preview does. Pass NULL only when the census would report `(none)` or `(blank)`.
2. Read July `sourceCampaignName`. Do not substitute a workbook label.
3. Write the registry alias and its append-only event through the existing history rules.
4. Call `historical_campaign_ownership_decision` after that write.
5. Stamp `LeadInventoryItem.originClientAccountId` only where it is still null, the July label still normalizes to the same identity, and the SQL decision is `eligible`.
6. Leave a different existing origin in place and record a conflict. Do not overwrite it.
7. Do not write `HistoricalResaleAuthorization`.
8. Do not release, deliver, export, cancel, or modify LO-1053 allocations.
9. Keep PR #188 on HOLD until operators have used this preview and a confirmation path exists. Merging #188 first would block those 16 reserved Vet leads.

Resale remains a separate later PR with external evidence. A campaign name, exclusivity flag, acquisition cost, or Used By value is not resale evidence.

## Proposed catalog-only gate

This section is a proposal. It is not implemented, and neither flag below is activated by the projection read path.

Today `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` gates both the historical catalog and ownership preview before authentication. Turning the catalog on therefore also turns preview on. Those operations should be separate.

Proposed flag: `SA360_HISTORICAL_CAMPAIGN_CATALOG_ENABLED`, exact string `true`, on the API process only. Any other value, including unset, leaves the catalog route unavailable before authentication, as it is today. Do not set `NEXT_PUBLIC_SA360_HISTORICAL_CAMPAIGN_CATALOG_ENABLED`.

`POST /admin/v1/fulfillment-ops/historical-campaign-catalog` would check that catalog flag, then the existing operator admin key. It would keep the read-only repeatable-read snapshot and the 20-second statement timeout. It would not call ownership preview, confirmation, or resale.

`POST /admin/v1/historical-campaign-associations/ownership-previews` would stay behind `SA360_HISTORICAL_CAMPAIGN_ASSOCIATION_ENABLED` only. Setting the catalog flag would not register or enable preview. Setting the association flag would not, by itself, be required for a later catalog-only route.

These routes stay unregistered either way:

- `POST /admin/v1/historical-campaign-associations/ownership-confirmations`
- `POST /admin/v1/historical-campaign-associations/ownership-reassignments`
- `POST /admin/v1/historical-campaign-resale/previews`
- `POST /admin/v1/historical-campaign-resale/confirmations`

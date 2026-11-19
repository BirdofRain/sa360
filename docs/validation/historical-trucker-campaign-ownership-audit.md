# Historical trucker campaign ownership audit

Scope: lot `lot_aged_bulk_trucker_4b0d299a1651`, import request
`aged-bulk-trucker-4b0d299a1651`, source `manual_import` / `csv_import`,
example Lead Type `JR Laird - Trucker - 3/4/26`.

This environment can reach only local Postgres at `127.0.0.1`. It cannot read
the production database. No production count, including the stated 2,022
available GA rows, is verified here. The local auditor run is not a substitute
for that count.

## Decision

**NO-GO** on fulfilling the unresolved-origin GA trucker cohort.

**NO-GO** on repairing ownership in production until a read-only production run
of `pnpm inventory:audit-trucker-campaigns` shows July labels present and
consistent.

Repair without re-import is possible only as a later, operator-confirmed stamp
of `originClientAccountId` on existing `SourceLeadEvent` / `LeadInventoryItem`
rows. It is not authorized by a local or empty result. A clean remote report
is `conditional_go_labels_only`: fulfillment stays **NO-GO** until origin is
confirmed and the selection path fails closed.

## What the July 30 writer stored

Commit `4ae73c8` (2026-07-30, “Add scalable aged inventory bulk import”) is the
writer that creates this lot key and import request id:

- lot key `lot_aged_bulk_${niche}_${fileSha256.slice(0, 12)}`
- import request `aged-bulk-${niche}-${fileSha256.slice(0, 12)}`
- `sourceProvider = manual_import`, `sourceSystem = csv_import`,
  `sourceType = bulk_import`
- `sourceRouteKey = AGED_BULK::<lotKey>`
- `sourceCampaignName` = trimmed `Lead Type`
- `normalizedPayloadJson.campaign_name` = the same Lead Type
- `rawPayloadJson` = `{ importRequestId, rowNumber }` only
- inventory `metadataJson.campaignNamePresent`, `importRequestId`, `rowNumber`
- `sourceLeadId` = `aged-v1-<niche>-<sha256 prefix>` of
  `niche|phone|email|generated date|first|last`
- `sourceLeadUid` = `manualimport-aged_inventory_csv-<sourceLeadId>`
- initial status `pending_review`
- `originClientAccountId` did not exist yet (added 2026-09-10) and is not set
  by this importer

`Lead Type` is not the niche. Niche comes only from `--default-niche trucker`.

## What later code can change

Enrichment (`c98a40d`, 2026-08-19) updates JSON only:

- Fills an empty `campaign_name`. A non-empty value that differs is left as-is
  and reported as a conflict.
- `mergeAgedBulkRawPayload` preserves `importRequestId` and `rowNumber`, then
  replaces `rawPayloadJson.master`, including `lead_type`, from the workbook
  being enriched.
- It does not update `sourceCampaignName`.

So `sourceCampaignName` is the July Lead Type. `master.lead_type` is July
evidence only when enrichment metadata is absent. When
`enrichmentMetadataJson.historicalEnrichment` is present, a differing
`master.lead_type` is a later workbook, not a second July identity.

Recovery (`4635dd2`) creates new events in a different lot. It does not stamp
origin on the July lot. Exact source-id matches are not inserted again.

Activation (`aged-inventory-ops-verify`) moves `pending_review` to `available`
after verification. It does not read campaign or origin.

## Source-id collisions

The source id omits Lead Type. Two master rows with the same niche, phone,
email, date, and name, and different Lead Types, collapse to one id. The
importer skips the second row (`exact_source_duplicate` / existing source id).
That dropped label is not in the database and cannot be repaired without a
source file that is proven to be the July file. The auditor counts only labels
that were stored, including two events that share a source id with different
`sourceCampaignName` values.

## Fulfillment paths that still accept unresolved manual imports

Buyer availability reporting already excludes them. These paths do not:

| Path | Origin behavior |
| --- | --- |
| `lookupBuyerInventoryAvailability` | Null `manual_import` is `provider_not_reconcilable` and is not buyer-eligible. |
| `queryEligibleInventoryCandidatesBounded` | `isOriginClientBuyerIneligible` is false when origin is null. Test K expects the null-origin row to stay eligible. |
| `revalidateCandidateUnderLock` | Rechecks status, `commerceExcludedAt`, and buyer-ready age. It does not read origin. |
| `reserveLeadAllocationAtomicTx` | Reserves an `available` item with `commerceExcludedAt` null. |
| Buyer CSV preview/commit | Exports `reserved` / `delivering` / `committed` allocations. Campaign text is not a buyer column. |
| `releasePplAllocation` | Returns the item to `available`. |
| `SourceFunnel` confirm/reassign | Matches `sourceProvider` + `sourceCampaignId` (LeadCapture funnel id or parent URL). Bulk rows leave `sourceCampaignId` null, so this registry cannot stamp them. |
| Campaign inventory tracking | Origin resolution returns null unless `sourceProvider` is `leadcapture_io`. |
| Commerce exclusion | Holds a row only after an explicit stamp. Unresolved origin does not set it. |

Client display-name similarity, phone, and email are not ownership. Acquisition
and resale evidence must stay independent of the origin stamp.

## Auditor

`pnpm inventory:audit-trucker-campaigns` runs `SET transaction_read_only` and
selects campaign labels, import ids, row numbers, source ids, origin ids,
lifecycle, and lot snapshot metadata. It does not select phone, email, or
consumer names.

```bash
pnpm inventory:audit-trucker-campaigns -- \
  --expected-db-host <host or host:port> \
  --confirm-read-only "READ ONLY HISTORICAL CAMPAIGN AUDIT"
```

Exit 2 means the lot has no matching inventory rows on the database in
`DATABASE_URL`. On localhost that means the lot is absent locally, not that
production was checked.

## Proposed PRs

1. **Fail-closed selection gate** (no migration). Use the same unresolved-origin
   rule as buyer availability inside `queryEligibleInventoryCandidatesBounded`
   and `revalidateCandidateUnderLock`: null origin on a non-LeadCapture provider
   is not selectable. Update test K. Rollback is reverting that predicate.
   This holds every unresolved manual import, including this lot, without a
   production data write.
2. **Production read of this auditor** (ops, read-only role). No code. Required
   before any backfill. Do not point it at a newer workbook.
3. **Alias registry migration** (Auth/Account lane only). A new
   import-scoped alias table, not a second `SourceFunnel`. Many exact Lead Type
   strings per client, confirmation and reassignment events, and a separate
   acquisition/resale record that does not stamp origin. Migration is additive
   and contains no backfill.
4. **Backfill command** after the registry. Dry-run default. Stamp null origin
   only for inventory in the confirmed import scope whose `sourceCampaignName`
   equals the confirmed Lead Type exactly, and whose `campaign_name` and
   `master.lead_type` are either empty or equal to that text. Match
   `sourceLeadEventId` / inventory id. Never match phone or email. Never create
   inventory. Rollback clears only the stamped ids recorded by that run when
   they still have no allocation.
5. **Admin C.O.C. association UI** after the registry API exists. List aliases,
   conflicts, and confirmation state. Do not render contact fields.

## Tests

`apps/api/src/services/aged-inventory-bulk/historical-trucker-campaign-audit.test.ts`
covers label classification, collision counts, the local NO-GO decision, SQL
shape, read-only transaction rejection, and a local fixture that stores a
secret phone and email and asserts they are absent from the report.

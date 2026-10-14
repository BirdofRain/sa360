# External delivery receipt enforcement

Local-only guidance for historical spreadsheet receipts. Production migrate,
flag activation, and Vanessa workbook import each require separate approval.
Do not import private customer files into GitHub, logs, or agent artifacts.

## Two independent controls

| Control | Environment variable | Default | What it gates |
| --- | --- | --- | --- |
| Receipt administration | `SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` | off (`true` required) | Preview, apply, and FOWB Stage 2f import tools |
| Buyer-suppression enforcement | `SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED` | on (anything except `false`) | Loading applied receipts during buyer selection / reservation / export |

Disabling the import UI must not disable suppression of already-applied receipts.
Once production migrations are applied and verified, confirmed applied receipts
remain enforced even when `SA360_PPL_EXTERNAL_RECEIPT_IMPORT_ENABLED` is unset.

## Delivery evidence vs inventory association

- **Inventory association** (`matchStatus`): `matched`, `unmatched`, or `ambiguous`.
  Unmatched and ambiguous rows stay visible after apply.
- **Delivery evidence** (`deliveryEvidenceStatus`): `unverified`, `operator_confirmed`,
  or `not_a_delivery`.
- Apply never infers delivery from an unmatched spreadsheet row alone.
- Matched preview rows with a valid phone or email fingerprint may be applied with
  the confirmation phrase.
- Unmatched or ambiguous preview rows require both
  `confirmUnmatchedHistoricalDeliveries=true` and non-empty `sourceEvidence`.
- Rejected-before-delivery, blank, malformed, extra-occupied, and unconfirmed rows
  are never applied.
- Apply writes `BuyerExternalDeliveryReceipt.applyStatus=applied` only. It never
  creates `LeadAllocation` or `BuyerDeliveredIdentity` rows.
- Suppression is buyer-specific and uses phone-OR-email fingerprint matching.
  Email-only historical identities are valid when the phone is missing or unusable.
- Historical row grouping uses the same phone-OR-email rule, including transitive
  overlaps. Exact repeats are extra occupied rows. A row that would merge two
  already-distinct identity groups is `identity_conflict` and is not applied.
  Connected rows keep their additional phone or email fingerprints.

## Fail-closed fulfillment

`loadAppliedExternalReceiptFingerprints()` always queries applied receipts when
enforcement is on, regardless of the import flag.

It fails closed (throws `historical_delivery_suppression_unavailable`) when:

- the applied-receipt query fails or the model is unavailable on a real path
- `SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED=false` **and** applied receipts
  already exist for that buyer

Buyer preview, reservation, replacement, and export that cannot load existing
applied receipts must block fulfillment for the affected buyer rather than
return an empty historical-delivery set.

## Deployment

1. Apply the receipt migrations to the **local / authorized** database only.
   Production migrate remains a separate authorization.
2. Verify schema-lock counts and selection/receipt tests.
3. Keep import disabled until an authorized operator previews a synthetic batch.
4. After applied receipts exist, enforcement stays on even if import is turned off.

### Merge vs production migrate (do not run from this document)

PR #177 has no schema change and can merge independently.

PRs #178 and #179 add Prisma migrations. Repo docs recommend a DigitalOcean
`PRE_DEPLOY` `sa360-migrate` job (`pnpm migrate:deploy`) so schema applies
before traffic switches. That job is **not checked into an app spec in this
repo**; it lives in the App Platform console if it was added after the LF2
cutover. If auto-deploy is on and PRE_DEPLOY migrate is missing, merging #178
or #179 would ship Prisma clients that query new tables/columns before they
exist. #179 also fail-closes buyer fulfillment when applied receipts cannot be
loaded — a missing receipt table would block selection.

Safe order when auto-deploy is on and PRE_DEPLOY migrate is confirmed:

1. Merge #177.
2. Merge #178 — PRE_DEPLOY must apply `20261013160000` before API/worker start.
3. Merge #179 — PRE_DEPLOY must apply `20261013170000`, `20261013180000`, and
   `20261013190000` before API/worker start.
4. Validate receipt suppression against local/synthetic data.
5. Separate approvals for import-flag activation and any real workbook import.

If PRE_DEPLOY migrate is not confirmed, pause auto-deploy, merge, migrate
production under separate authorization, then deploy the app.

## Rollback

- Turning import off is the safe way to stop new receipt administration.
- Do not set `SA360_PPL_EXTERNAL_RECEIPT_SUPPRESSION_ENABLED=false` when applied
  receipts exist. That combination fail-closes buyer fulfillment on purpose.
- Do not deploy or roll back to a version that cannot read
  `BuyerExternalDeliveryReceipt` rows with `applyStatus=applied`. A version
  unable to enforce existing applied receipts must block buyer fulfillment
  until a version that can read those rows is restored.
- Rolling back the receipt migrations after applied rows exist is unsafe.

## Accounting check (synthetic only)

Vanessa's final 10/12 sheet is 3,260 delivered data rows plus one header. The
original export had 3,304 rows; 44 were omitted as rejected-before-delivery.
Keep the real workbook out of the repository. Synthetic tests prove the 3,260 /
44 / 3,304 split, cross-tab dedupe, and buyer-specific suppression.

# Consumer age maintenance runbook

## Scope

Historical consumer-age and buyer-enrichment integrity for life-insurance inventory
(`vet`, `nurse`, `trucker` and their aliases).

Consumer age is now a hard fulfillment requirement: selection, reservation, buyer CSV
preview, buyer CSV commit, and spreadsheet release all fail closed when a lead has no
resolvable age, an unusable age, or an age above the maximum sellable age (86 inclusive).
This runbook covers the three maintenance operations that find and fix the inventory the
new policy blocks.

Two things *do* now happen automatically and are documented here too: inventory created
or activated with a known age over the maximum is stamped dead in the same transaction
(see [Automatic dead classification](#automatic-dead-classification-at-creation-and-activation)),
and an optional flag-gated worker re-checks date-of-birth inventory on a cadence (see
[Automatic birthday sweep](#automatic-birthday-sweep)). Everything in the CLI below is
manual and always requires a preview first.

| Operation | Writes | Confirmation phrase |
| --- | --- | --- |
| `--mode preview` | never | none required |
| `--mode backfill` | `SourceLeadEvent.normalizedPayloadJson` only | `BACKFILL HISTORICAL CONSUMER AGE` |
| `--mode classify-dead` | `LeadInventoryItem` lifecycle + commerce exclusion | `CLASSIFY CONSUMER AGE OVER 86 AS DEAD` |

The two confirmation phrases differ on purpose. A backfill authorization can never be
replayed as a dead-lead classification.

## The completion rule

Every result — preview, backfill, and classify-dead alike — carries two fields that
together are the **only** authoritative answer to "am I done?":

| Field | Meaning |
| --- | --- |
| `coverage` | `"complete"` means the scope was traversed to exhaustion. `"partial"` means the per-invocation scan ceiling stopped it early. |
| `nextCursor` | Non-null exactly when `coverage` is `"partial"`. Feed it back in to continue. |

**Stop only when `coverage == "complete"` AND `nextCursor == null`.**

Do not infer completion from a candidate count. A window can report zero candidates
simply because the ceiling cut it short before reaching any. `coverage` is decided
structurally — a page that comes back short or empty is the only proof of exhaustion — so
a concurrent insert cannot make a truncated scan look finished.

These fields describe the *scan*, not the write limit. `coverage: "complete"` with
`candidatesInScannedWindow` greater than `candidatesWritten` means the whole scope was
read and `--limit` is what left rows behind; re-run with the same scope.

| Field | Meaning |
| --- | --- |
| `scan.matchingRows` | rows matching the scope, shard, and incoming cursor — i.e. what is still ahead of this invocation |
| `scan.rowsScanned` | rows this invocation classified |
| `scan.scanCeilingHit` | the ceiling, not exhaustion, ended the traversal |
| `candidatesInScannedWindow` | candidates found in the rows this invocation actually read |
| `candidatesWritten` | rows this invocation wrote |

## Traversing production-scale inventory

Production inventory is roughly 250k rows and one invocation may scan at most 50,000. The
ceiling stays; you chain invocations past it.

### Cursor chaining

```bash
# First invocation.
pnpm consumer-age:maintenance -- --mode preview --max-scan-rows 50000

# -> "coverage": "partial",
#    "nextCursor": { "afterGeneratedAt": "2025-03-04T11:02:00.000Z", "afterId": "clx..." }

# Continue from exactly where it stopped.
pnpm consumer-age:maintenance -- --mode preview --max-scan-rows 50000 \
  --after-generated-at 2025-03-04T11:02:00.000Z \
  --after-id clx...
```

Ordering is deterministic on `(generatedAt, id)`, so chained invocations neither skip nor
re-process a row. `--after-generated-at` and `--after-id` must be supplied together; one
without the other is refused. Roughly five chained invocations cover 250k rows.

Writing modes chain identically. Because repaired rows stop being candidates and
classified rows leave the scope, chaining also means the traversal never gets stuck
re-reading page one.

### Date-range sharding

For a predictable, resumable pass over a large inventory, shard by month instead of (or in
addition to) chaining:

```bash
for month in 2025-01 2025-02 2025-03; do
  pnpm consumer-age:maintenance -- --mode preview \
    --generated-at-from "${month}-01T00:00:00.000Z" \
    --generated-at-to   "${month}-31T23:59:59.999Z"
done
```

Both bounds are inclusive and use the same `(generatedAt, id)` ordering, so a shard can
itself be cursor-chained if one month still exceeds the ceiling. Sharding does not raise
the row cap. `--generated-at-from` later than `--generated-at-to` is refused.

## Consumer age vs lead age

CONSUMER age is the age of the person. LEAD age is how old the lead record is.

Consumer age is resolved only from explicit stored cells: a recognized date of birth
(preferred — it stays correct as time passes) or an explicit stored age. It is never
derived from `generatedAt`, `lead_date`, a submission date, a commerce age bucket, or
`LeadInventoryItem` age in days. An explicit integer age with no date of birth is used
exactly as stored and is never incremented, because no birthday is known.

## Step 1 — preview (read-only, safe anywhere)

```bash
pnpm consumer-age:maintenance -- --mode preview
```

Issues only `SELECT` / `COUNT` queries. Reports aggregate totals only: no name, phone,
email, or payload value is emitted.

Read the result in this order:

| Field | Decision it drives |
| --- | --- |
| `totals.activeSellableInventory` | size of the cohort in scope |
| `totals.ageAlreadyNormalized` | already compliant; nothing to do |
| `totals.recoverableTotal` | the backfill will fix these |
| `totals.recoverableFromRawPayload` / `FromMetadata` / `FromEnrichment` | where the age survived |
| `totals.dateOfBirthRecoverable` | exact ages, recomputed at every evaluation |
| `totals.noAgeSource` | **not recoverable.** Needs re-enrichment or supplier follow-up. Never classify these dead. |
| `totals.invalidAgeSource` | an explicit cell exists but does not parse. Inspect the source before deciding. |
| `totals.ageOverMaximum` | commercially dead candidates |
| `totals.canonicalConflicts` | canonical value differs from the resolver's choice. **Never auto-overwritten** — review manually. |
| `totals.conflictHolds` | conflicts withheld from *every* automatic operation. See [Conflict holds](#conflict-holds). |
| `totals.backfillCandidates` | exactly how many rows `--mode backfill` would write |
| `totals.deadClassificationCandidates` | exactly how many rows `--mode classify-dead` would write |
| `totals.deadClassificationBlockedByAllocation` | over-maximum rows protected because an allocation exists |
| `coverage` / `nextCursor` | whether these totals cover the whole scope. See [The completion rule](#the-completion-rule). |

Breakdowns (`breakdown.byNiche`, `bySourceProvider`, `bySourceSystem`, `bySourceLane`,
`byInventoryLot`, `byGeneratedMonth`) locate the gap. A single lane or lot dominating
`recoverableTotal` points at one import path; a single generated month points at a
one-time regression.

`breakdown.byInventoryLot` buckets carry both `inventoryLotId` and the human-readable
`lotKey`. Pass `inventoryLotId` straight to `--inventory-lot-id`; no translation needed.

Narrow the scope to preview a single cohort before acting on it:

```bash
pnpm consumer-age:maintenance -- --mode preview --niche vet --source-lane aged_inventory_csv
pnpm consumer-age:maintenance -- --mode preview --inventory-lot-id <inventoryLotId>
```

## Conflict holds

A row whose canonical consumer age materially disagrees with an explicit date of birth —
canonical `55` against a date of birth that resolves to `87`, say — is a **conflict hold**.
No automatic operation mutates it:

- the backfill does not write its age or date of birth, and it is absent from `updatedIds`
- dead classification does not stamp it, even when the date of birth resolves above the
  maximum
- the birthday sweep does not touch it
- creation, promotion, review `make_available`, and aged lot activation do not stamp it

The rule lives in the shared lifecycle writer (`isCanonicalAgeConflictHold` in
`consumer-age-dead-classification.ts`), not in the maintenance scan, so calling the writer
directly from a lifecycle transaction cannot bypass it. Those call sites report the skip
as `canonical_age_conflict`.

Writing the date of birth would move the row's effective commercial age from sellable to
dead in the same breath as calling it a conflict, and the date of birth is just as likely
to be the wrong value. Reservation re-validates age independently, so an unstamped
conflict cannot be sold by accident.

Every result lists them under `conflicts`, with ages and a source category only — no
consumer data:

```json
{
  "id": "clx...",
  "existingCanonicalAge": "55",
  "resolvedDobAge": "87",
  "resolvedSource": "raw_dob",
  "resolvedStatus": "over_maximum_age"
}
```

Resolve each one by hand: establish which value is correct with the supplier or the
original submission, correct the wrong cell at the source, then re-run the preview. The
row leaves `conflicts` once the two values agree.

## Step 2 — backfill (requires authorization)

Promotes a recovered age — and a date of birth when one is known — onto the canonical
normalized destination (`lead_details.consumer_age`, `lead_details.date_of_birth`).

```bash
pnpm consumer-age:maintenance -- \
  --mode backfill \
  --expected-db-host <host or host:port> \
  --operator <your name> \
  --limit 250 \
  --confirm "BACKFILL HISTORICAL CONSUMER AGE"
```

Guarantees:

- Blank canonical destinations only. A conflicting non-blank canonical value is reported
  in `conflictIds` and left untouched.
- A material date-of-birth conflict is held back entirely. See
  [Conflict holds](#conflict-holds).
- Never fabricates a date of birth from an age.
- Never creates inventory; never touches identity, `generatedAt`, lead commerce age, or
  allocation ownership.
- Over-maximum ages are promoted. Promoting an age and classifying it dead are separate
  decisions, so the classification step can see an accurate value.
- Bounded by `--limit`, and resumable through `nextCursor`.
- Idempotent. A run with nothing left to do returns `outcome: "NOOP"`.

Start with a small `--limit`, re-preview, confirm the totals moved as expected, then
increase. Re-run until `coverage == "complete"`, `nextCursor == null`, and
`candidatesInScannedWindow == 0`.

## Step 3 — dead-lead classification (requires separate authorization)

Preview the over-maximum cohort on its own first, then:

```bash
pnpm consumer-age:maintenance -- \
  --mode classify-dead \
  --expected-db-host <host or host:port> \
  --operator <your name> \
  --limit 250 \
  --confirm "CLASSIFY CONSUMER AGE OVER 86 AS DEAD"
```

Writes, per classified item:

| Field | Value |
| --- | --- |
| `status` | `expired` |
| `expiredAt` | now |
| `commerceExcludedAt` | now |
| `commerceExcludedReason` | `consumer_age_over_86` |
| `commerceExcludedBy` | `consumer_age_policy_v1` |

Operator-facing category: `Dead — Age over 86`.

Guarantees:

- **Unallocated inventory only.** Any item with a `LeadAllocation` of any status is
  skipped with `allocation_exists`. Delivered historical packages cannot be reached.
- Age is re-resolved under `FOR UPDATE` immediately before the write. A row whose age
  changed since the preview is skipped with `age_no_longer_over_maximum`.
- Reserved, committed, and fulfilled rows are blocked by status before any write.
- **Missing-age inventory is never classified dead.** It is reported as
  `Ineligible — Age required` and stays `available` with `commerceExcludedAt = null` so a
  later backfill or re-enrichment can rescue it. Incomplete enrichment is not a permanent
  defect.
- A material date-of-birth conflict is skipped with `canonical_age_conflict`. See
  [Conflict holds](#conflict-holds).
- Idempotent. Already-excluded rows fall out of scope, so a replay returns `NOOP`.

There is no un-classify path. Treat this as permanent.

## Automatic dead classification at creation and activation

Known-over-maximum inventory must never appear operationally as available, so the stamp is
now applied at the moment a row becomes live rather than waiting for a maintenance run.
The same shared writer used by the CLI (`classifyConsumerAgeOverMaximum`) runs inside the
existing authorized lifecycle transaction in:

| Path | Trigger |
| --- | --- |
| `campaign-inventory-tracking.service.ts` | new inventory created, and promotion of an existing row to `available` |
| `lead-inventory-review-action.service.ts` | the reviewed `make_available` action |
| `aged-inventory-ops-verify.service.ts` | bulk lot activation (`activateLot`) |

The row is stamped `status = expired` with the full commerce-exclusion kill switch in the
same transaction as the transition, so there is no window in which it is sellable.

What this does **not** do:

- Missing and unusable ages are not touched. They stay live as
  `Ineligible — Age required`, recoverable by backfill or re-enrichment.
- Allocated, reserved, committed, and fulfilled inventory is never modified.
- Selection Preview has no write side effects; it remains read-only.

`aged-inventory-ops-verify` reports the count in its `summaryJson` as
`consumerAgeOverMaximumClassified`. If a lot activation shows an unexpected number there,
preview that lot (`--inventory-lot-id`) before investigating the import.

## Automatic birthday sweep

A date-of-birth lead that is 86 today is 87 tomorrow, so unallocated inventory has to be
re-checked after activation. An optional BullMQ repeatable job in `apps/worker` does this.

**The flag defaults off.** While it is off, worker startup removes any existing schedule,
so turning it off is enough to stop it.

| Variable | Default | Purpose |
| --- | --- | --- |
| `SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_ENABLED` | `false` | master switch |
| `SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_EXPECTED_DB_HOST` | *(none)* | **required when enabled.** Host or `host:port` the sweep may write to |
| `SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_INTERVAL_MINUTES` | `360` | cadence, clamped to `[15, 1440]` |
| `SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_BATCH_SIZE` | `200` | rows one invocation may write, clamped to `[1, 1000]` |
| `SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_SCAN_ROWS` | `5000` | rows one invocation may read, clamped to `[1, 50000]` |
| `SA360_CONSUMER_AGE_BIRTHDAY_SWEEP_MAX_BATCHES` | `10` | cursor continuations one tick may chain, clamped to `[1, 100]` |

Behavior:

- Candidates are restricted to **unallocated inventory with an explicit date of birth**. A
  stored integer age does not change on its own, so sweeping it would only widen the
  automatic write population for no benefit.
- It uses the same canonical resolver, the same bounded cursor traversal, and the same
  shared lifecycle writer as the manual CLI. No business rule is duplicated in the worker.
- It refuses unless `DATABASE_URL` resolves to the configured authorized host, so a
  misdirected connection string refuses instead of writing.
- One tick chains `nextCursor` in place up to the continuation budget, which lets a single
  tick traverse past the per-invocation scan ceiling. The next tick restarts the scope,
  which is safe because classified rows leave it.
- Repeated runs are idempotent; logs carry counts only, never consumer data.
- Reservation remains the final safety gate regardless of what the sweep has seen.

Enabling it does not replace the CLI. Run `--mode preview` first to see how many rows the
first few ticks would write, and keep the manual `--mode classify-dead` available for
targeted work.

Inspect configuration without writing:

```bash
curl -s -H "x-sa360-admin-key: $ADMIN_API_KEY" \
  "$API/admin/v1/consumer-age/birthday-sweep/diagnostics"
```

## A reserved allocation that crosses the maximum before export

The sweep and the CLI both refuse to touch reserved, committed, or fulfilled inventory, so
a lead reserved at 86 that turns 87 before the spreadsheet ships is **not** handled here.
Fulfillment catches it on its own: buyer CSV preview, commit, and release all fail closed
with `buyer_export_age_required`.

Resolve it through the existing allocation replacement workflow — release the reserved
allocation and let selection replace it with eligible inventory. Do not try to force the
export, and do not hand-edit the inventory row: once the allocation is released the row
becomes unallocated and the ordinary classification path will stamp it on the next pass.

## Refusals

Every refusal is returned as JSON with `writesAttempted: false` and a nonzero exit code.

| `reasonCode` | Cause |
| --- | --- |
| `REFUSED_TEST_RUNTIME` | `NODE_ENV=test`. Run from a shell where `NODE_ENV` is unset. |
| `database_url_required` | `DATABASE_URL` is empty |
| `confirmation_mismatch` | `--confirm` does not match the phrase for this mode |
| `operator_required` | `--operator` missing |
| `limit_required` | `--limit` is not a positive integer |
| `db_host_mismatch` | `--expected-db-host` does not match `DATABASE_URL` |
| `invalid_operator_input` | a numeric or instant flag is malformed; the offending `field` and `reason` are included |
| `scope_invalid` | the scope resolved from the supplied flags is not usable |

Numeric and instant flags fail closed. `--max-scan-rows abc`, `--max-scan-rows 0`,
`--max-scan-rows -10`, `--max-scan-rows 2.5`, `--max-scan-rows 50001`, a malformed
`--generated-at-from`, and a half-specified cursor are all refused with exit code `2` and
**no report is printed**. A non-numeric row bound must never become `NaN` and produce a
zero-row report that reads as "nothing to do".

## Related

- `apps/api/src/services/consumer-age/consumer-age-policy.ts` — the single canonical resolver
- `apps/api/src/services/consumer-age/consumer-age-dead-classification.ts` — the single lifecycle writer
- `apps/api/src/services/consumer-age/consumer-age-inventory-maintenance.service.ts` — these three operations
- `apps/api/src/services/consumer-age/consumer-age-birthday-sweep.service.ts` — the recurring sweep
- `GET /admin/v1/ppl/orders/:orderId/selection-funnel` — per-order `consumerAgePolicy` stages
- `docs/runbooks/lead-inventory-foundation-v1.md` — inventory availability blockers

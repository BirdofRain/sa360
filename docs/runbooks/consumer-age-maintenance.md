# Consumer age maintenance runbook

## Scope

Historical consumer-age and buyer-enrichment integrity for life-insurance inventory
(`vet`, `nurse`, `trucker` and their aliases).

Consumer age is now a hard fulfillment requirement: selection, reservation, buyer CSV
preview, buyer CSV commit, and spreadsheet release all fail closed when a lead has no
resolvable age, an unusable age, or an age above the maximum sellable age (86 inclusive).
This runbook covers the three maintenance operations that find and fix the inventory the
new policy blocks.

**Nothing in this runbook runs automatically.** Always preview first.

| Operation | Writes | Confirmation phrase |
| --- | --- | --- |
| `--mode preview` | never | none required |
| `--mode backfill` | `SourceLeadEvent.normalizedPayloadJson` only | `BACKFILL HISTORICAL CONSUMER AGE` |
| `--mode classify-dead` | `LeadInventoryItem` lifecycle + commerce exclusion | `CLASSIFY CONSUMER AGE OVER 86 AS DEAD` |

The two confirmation phrases differ on purpose. A backfill authorization can never be
replayed as a dead-lead classification.

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
| `totals.backfillCandidates` | exactly how many rows `--mode backfill` would write |
| `totals.deadClassificationCandidates` | exactly how many rows `--mode classify-dead` would write |
| `totals.deadClassificationBlockedByAllocation` | over-maximum rows protected because an allocation exists |
| `scan.exact` | `false` means the scan ceiling was reached and the totals are partial |

Breakdowns (`breakdown.byNiche`, `bySourceProvider`, `bySourceSystem`, `bySourceLane`,
`byInventoryLot`, `byGeneratedMonth`) locate the gap. A single lane or lot dominating
`recoverableTotal` points at one import path; a single generated month points at a
one-time regression.

Narrow the scope to preview a single cohort before acting on it:

```bash
pnpm consumer-age:maintenance -- --mode preview --niche vet --source-lane aged_inventory_csv
pnpm consumer-age:maintenance -- --mode preview --inventory-lot-id <lot id>
```

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
- Never fabricates a date of birth from an age.
- Never creates inventory; never touches identity, `generatedAt`, lead commerce age, or
  allocation ownership.
- Over-maximum ages are promoted. Promoting an age and classifying it dead are separate
  decisions, so the classification step can see an accurate value.
- Bounded by `--limit`. `moreCandidatesRemain: true` means candidates are left; re-run.
- Idempotent. A run with nothing left to do returns `outcome: "NOOP"`.

Start with a small `--limit`, re-preview, confirm the totals moved as expected, then
increase. Re-run until `moreCandidatesRemain` is `false`.

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
- Idempotent. Already-excluded rows fall out of scope, so a replay returns `NOOP`.

There is no un-classify path. Treat this as permanent.

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

## Related

- `apps/api/src/services/consumer-age/consumer-age-policy.ts` — the single canonical resolver
- `apps/api/src/services/consumer-age/consumer-age-inventory-maintenance.service.ts` — these three operations
- `GET /admin/v1/ppl/orders/:orderId/selection-funnel` — per-order `consumerAgePolicy` stages
- `docs/runbooks/lead-inventory-foundation-v1.md` — inventory availability blockers

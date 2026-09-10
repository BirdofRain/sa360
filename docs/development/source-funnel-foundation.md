# SourceFunnel foundation — origin provenance

This foundation PR stamps `LeadInventoryItem.originClientAccountId` when:

1. a `SourceFunnel` is `confirmed` with `originClientAccountId`, **and**
2. a **new** inventory item is created from a NextGen `SourceLeadEvent` whose
   `sourceCampaignId` equals that funnel's `providerFunnelId`.

Reuse of an existing canonical item (same phone/email/source lead) does **not**
overwrite an already-stamped origin. Suggestions never stamp.

Inventory mutations that change origin provenance are always **bounded** to
rows whose `SourceLeadEvent.sourceProvider` + `sourceCampaignId` match this
`SourceFunnel`. There is no unbounded global inventory rewrite.

## Operator primitives, inventory, and registry must agree

Three internal service operations (no public HTTP routes, no Admin C.O.C. UI
in this PR) keep the registry and matching inventory aligned.

### Initial confirm (`confirmSourceFunnelOrigin`)

For an unassociated or suggested funnel:

- set `associationStatus=confirmed`
- set `originClientAccountId`
- preserve existing suggestion metadata
- fill **NULL** origin rows only, in the same transaction

If the funnel is already confirmed to the **same** client, confirm is
idempotent: it does not rewrite non-NULL stamps, and it only fills remaining
NULL rows for this funnel.

If the funnel is already confirmed to a **different** client, confirm does
**not** silently reassign. It fails with `SourceFunnelOriginCorrectionError`
(`confirm_requires_explicit_reassign`). Use `reassignSourceFunnelOrigin`.

### Explicit reassignment (`reassignSourceFunnelOrigin`)

Operator-controlled correction for a later Admin C.O.C. UI. Requires an
already-confirmed origin and a **different** existing `ClientAccount`.

Within one transaction:

1. update `SourceFunnel.originClientAccountId` to the new client
2. inventory sourced from this funnel:
   - `originClientAccountId = NULL` → new client (`newlyStamped`)
   - `originClientAccountId = previous confirmed client` → new client (`reassigned`)
   - `originClientAccountId = some third non-null client` → **not overwritten**
     (`conflictsSkipped`)

This is the only path that intentionally rewrites matching previously stamped
origin ownership.

### Explicit clear (`clearSourceFunnelAssociation`)

**Correction policy:** clear is a correction, not a historical-preservation
write. Registry and matching inventory must not silently disagree.

Within one transaction:

1. load the previously confirmed origin (if any)
2. set the registry to `unassociated` (clear origin and suggestion)
3. set `LeadInventoryItem.originClientAccountId` to NULL **only** for inventory
   sourced from this SourceFunnel whose origin equals that previous confirmed
   client

Third-party / non-matching origin stamps are not cleared. Returns
`clearedInventoryCount`.

If the funnel was not confirmed (or had no origin), the registry is still
reset to unassociated and no inventory stamps are touched
(`clearedInventoryCount = 0`).

## Passive funnel rename vs operator correction

| Action | Origin registry | Matching inventory stamps |
| --- | --- | --- |
| Passive funnel rename / title change on observe | **Never** changes a confirmed origin | Existing stamps unchanged; new items still stamp the current confirmed origin |
| Explicit operator reassignment | Confirmed origin becomes the new client | NULL and previous-origin rows become the new client; third-party conflicts are skipped |
| Explicit operator clear | Returns to unassociated | Matching previous-origin stamps become NULL; third-party stamps remain |

A LeadCapture title rename is **not** an origin correction. Only the explicit
reassign/clear primitives change confirmed provenance.

## P2 exclusion

P2 buyer exclusion reads the **persisted** `LeadInventoryItem.originClientAccountId`
stamp, not the live `SourceFunnel` row. After a correction, exclusion follows
the updated stamp: the new origin client is excluded, the previous origin
client is no longer excluded by origin, and `BuyerDeliveredIdentity` exclusion
is unchanged.

## Later work (not this PR)

- Admin C.O.C. confirmation / reassignment / clear UI calling
  `confirmSourceFunnelOrigin`, `reassignSourceFunnelOrigin`, and
  `clearSourceFunnelAssociation`.
- Optional `CREATE INDEX CONCURRENTLY` on
  `SourceLeadEvent (sourceProvider, sourceCampaignId)` if confirm-time
  backfill is slow (cannot live in a transactional Prisma migration).
- Optional job to backfill historical inventory for a newly confirmed funnel
  when the event set is large, with a row cap and progress logging.

Do not flip `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` or install live LeadCapture
webhooks from the foundation PR.

# SourceFunnel foundation — origin provenance

This foundation PR stamps `LeadInventoryItem.originClientAccountId` when:

1. a `SourceFunnel` is `confirmed` with `originClientAccountId`, **and**
2. a **new** inventory item is created from a NextGen `SourceLeadEvent` whose
   `sourceCampaignId` equals that funnel's `providerFunnelId` **or**
   `parentUrlKey`.

Reuse of an existing canonical item (same phone/email/source lead) does **not**
overwrite an already-stamped origin. Suggestions never stamp.

Inventory mutations that change origin provenance are always **bounded** to
rows whose `SourceLeadEvent.sourceProvider` + `sourceCampaignId` match this
`SourceFunnel`'s identities (`providerFunnelId` and/or `parentUrlKey`). There is
no unbounded global inventory rewrite. A SourceFunnel that later gains both
identities backfills/corrects inventory stamped under either identity.

## Parent URL identity

Normalized `parent_url` is the zero-config fallback source identity when
LeadCapture does not provide a funnel/form UUID.

Canonical `parentUrlKey` for
`https://my.leadcapture.io/p/dn_omzoj?v=1789074011990` is
`my.leadcapture.io/p/dn_omzoj`. Query and fragment are stripped. `pageSlug`
(`dn_omzoj`) is operator convenience only and is not globally unique.

NextGen identity precedence:

1. `funnel_id`
2. `form_id`
3. `sa360_form_id`
4. legitimate LeadCapture UUID `campaign_id` / `sa360_campaign_id`
5. normalized `parent_url_key`
6. `sa360_route_key` compatibility fallback

A stale copied `sa360_route_key` never overrides `parent_url_key`.
`funnel_name` is metadata (`observedFunnelName` / niche / suggestion) and is
not machine source identity.

If UUID and `parentUrlKey` already point at **different** SourceFunnel rows,
intake does not silently merge them. It logs
`source_intake.leadcapture_nextgen.source_funnel_identity_conflict`, keeps the
lead/inventory, and leaves operator reconciliation as a follow-up.

## Operator primitives, inventory, and registry must agree

Internal service operations (no public HTTP routes, no Admin C.O.C. UI in
this PR) keep the registry and matching inventory aligned.

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

### Internal page-URL association (`associateSourceFunnelByPageUrl`)

Operator contract for the next Admin C.O.C. PR. Accepts a full URL or a
standard hosted page slug (`dn_omzoj` → `my.leadcapture.io/p/dn_omzoj`), finds
or pre-registers the SourceFunnel without fabricating `firstSeenAt`, and reuses
`confirmSourceFunnelOrigin` semantics (including explicit reassign when already
confirmed to a different client). The first natural lead later enriches
`observedFunnelName`, niche, and seen timestamps without losing the confirmed
origin.

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
  `confirmSourceFunnelOrigin`, `reassignSourceFunnelOrigin`,
  `clearSourceFunnelAssociation`, and `associateSourceFunnelByPageUrl`.
- Optional `CREATE INDEX CONCURRENTLY` on
  `SourceLeadEvent (sourceProvider, sourceCampaignId)` if confirm-time
  backfill is slow (cannot live in a transactional Prisma migration).
- Optional job to backfill historical inventory for a newly confirmed funnel
  when the event set is large, with a row cap and progress logging.

Do not change `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` as part of this PR.
Preserve the existing production value exactly (`inventory_only`). Do not
install a new live LeadCapture webhook. Validation should prove `parent_url_key`
at `inventory_only` and must not enable `routing_enabled`.

# Campaign inventory identity and ownership

Campaign inventory uses two identity tiers in strict precedence order.

## Tier 1: immutable source identity

1. The same `SourceLeadEvent.id`.
2. The same non-empty `(sourceProvider, sourceSystem, sourceLeadId)`.

These matches identify one submission, not merely one consumer. A replay always
reuses the canonical inventory item. If the same immutable submission resolves
to two different confirmed origin clients, tracking records
`ownership_conflict_review` and does not move, merge, or duplicate the item.
A previously NULL origin may be filled from a confirmed association because the
immutable identity proves that it is the same submission.

## Tier 2: consumer identity

1. Phone fingerprint.
2. Email fingerprint.
3. Historical normalized JSON phone/email compatibility for rows that predate
   indexed fingerprints.

Consumer identity is considered only after immutable source identity misses.
Phone retains precedence over email among ownership-compatible candidates.
These matches are reusable only under the following matrix:

| Incoming confirmed origin | Existing origin | Result |
| --- | --- | --- |
| Client A | Client A | Reuse |
| Client A | Client B | Create a separate Client A item; retain correlation |
| Client A | NULL | Create a separate item; do not claim ambiguous inventory |
| Unresolved | Confirmed client | Preserve existing global/review behavior; never overwrite origin |
| Unresolved | NULL | Preserve global reuse behavior |

Ownership comes only from the shared confirmed LeadCapture source-association
resolver. Client names, UTM values, and fuzzy text are not ownership evidence.

When a confirmed incoming client is separated from a phone/email-matched item,
the new item and incoming event tracking retain `consumerIdentityMatch`,
`relatedInventoryItemId`, `relatedSourceLeadEventId`,
`crossClientConsumerMatch`, and `ownershipCompatibility` metadata. This
correlation is non-blocking and never transfers ownership.

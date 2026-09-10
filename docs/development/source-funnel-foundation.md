# SourceFunnel foundation — origin backfill (next PR)

This foundation PR stamps `LeadInventoryItem.originClientAccountId` only when:

1. a `SourceFunnel` is `confirmed` with `originClientAccountId`, **and**
2. a **new** inventory item is created from a NextGen `SourceLeadEvent` whose
   `sourceCampaignId` equals that funnel's `providerFunnelId`.

Reuse of an existing canonical item (same phone/email/source lead) does **not**
overwrite an already-stamped origin. Suggestions never stamp.

## Confirm-time bounded backfill (this PR)

`confirmSourceFunnelOrigin` updates NULL-origin inventory whose source event
`sourceCampaignId` equals the funnel UUID, inside the same transaction as the
confirmation write. It does not scan the full inventory table as a business
filter, and it does not rewrite non-null origin stamps.

Changing a confirmed origin later also only fills NULL rows. Rewriting
already-stamped origin ownership is an operator-controlled action for a follow-up
PR (avoid silent ownership mutation).

## Next PR (background / Admin C.O.C.)

- Admin C.O.C. confirmation UI calling `confirmSourceFunnelOrigin` /
  `clearSourceFunnelAssociation`.
- Optional `CREATE INDEX CONCURRENTLY` on `SourceLeadEvent (sourceProvider, sourceCampaignId)`
  if confirm-time backfill is slow (cannot live in a transactional Prisma migration).
- Optional job to backfill historical inventory for a newly confirmed funnel when
  the event set is large, with a row cap and progress logging.
- P2 exclusion is already applied at PPL selection time for stamped origin;
  no further fulfillment refactor is required for the origin≠buyer rule.

Do not flip `SA360_LEADCAPTURE_NEXTGEN_INTAKE_STAGE` or install live LeadCapture
webhooks from the foundation PR.

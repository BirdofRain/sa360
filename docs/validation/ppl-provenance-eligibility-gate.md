# PPL provenance eligibility gate

Policy id: `ppl-provenance-eligibility-v1`.

Unresolved-origin inventory is ineligible for buyer selection, selection preview,
reservation, CSV export, spreadsheet delivery, release, and replacement approval.
The rule is the same one buyer availability already uses for non-LeadCapture
supply: a null origin is sellable only for `leadcapture_io`, or when a caller
already holds an explicit verified-acquisition id. This change does not create
that id.

Confirmed `originClientAccountId` remains approved resale. The origin client
still cannot buy its own inventory. Campaign labels, `exclusive`, Used By,
acquisition cost, and a null origin are not acquisition evidence.

## Deployment

Code only. No Prisma migration, no backfill, no inventory activation, no origin
stamp, and no production write. Ship the API and worker together so selection
and any in-process export path pick up the same predicate. Previously reserved
unresolved rows stay reserved; new export, delivery, release, and replacement
approval fail closed until a later explicit provenance pathway updates them.

## Rollback

Revert this change. There is no schema or data migration to undo. Rows that
were already reserved stay reserved. After rollback, selection and export again
treat null-origin non-LeadCapture inventory as sellable, which reopens the gap
this gate closes.

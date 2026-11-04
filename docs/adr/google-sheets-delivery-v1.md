# ADR: Google Sheets as an LF2 delivery adapter (v1 design)

Status: **proposed** (design only; not implemented)

## Context

SA360 is pausing Direct Meta Lead Ads at the Phase 1C flag-off checkpoint and
needs a customer Google account / Google Sheets delivery path for FREE-tier
fulfillment (portal + CSV + spreadsheet-style delivery).

The repo already has:

- Channel-neutral LF2 fulfillment (`DeliveryTarget` / `DeliveryInstruction` /
  `DeliveryAttempt` / `FulfillmentOutbox`)
- A planning-only stub `google_sheets.v1`
- GHL OAuth with AES-GCM tokens on a dedicated connection table
- Buyer CSV packages + manual “mark spreadsheet delivered”
- Inbound Google Sheet **intake** (Apps Script webhook), which is a source, not
  a destination

There is no Google OAuth, no Sheets API client, and no live sheet writer.

## Decision

1. **Sheets is an LF2 destination adapter**, not an intake special-case.
   Canonical flow: lead → allocation → `DeliveryInstruction` →
   `google_sheets.v1` `deliverLive` → `DeliveryAttempt`.
2. **Credentials live on `GoogleAccountConnection`**, keyed by `ClientAccount`,
   encrypted like GHL. Tokens never sit on `ClientAccount` or
   `DeliveryTarget.configMetadataJson`.
3. **Phase 1 UX:** customer OAuth + paste spreadsheet URL/ID, plus optional
   create-once. No Drive.readonly listing. No Google Picker.
4. **Live writes start as a manual canary** (GHL PR B pattern), deny-by-default
   flags, then optionally a new work type on the **existing** fulfillment outbox.
   No new queue.
5. **Do not extend** legacy `write_backup_sheet` / `backupSheetId` /
   `backup_sheet_export.mode` into the customer product. Freeze those.
6. **Do not replace** buyer CSV download. FREE keeps portal + CSV + Sheets push.

Full audit, schemas, scopes, flags, tests, and PR sequence:
`docs/architecture/google-account-sheets-delivery.md`.

## Consequences

- Auth/Account owns migrations and OAuth.
- Portal adds an integrations strip on `/portal/account` only after APIs exist.
- Ingestion must not change `sources-google-sheet` for this workstream.
- Google Cloud OAuth clients, consent screen, and test users are human-operated
  and out of band.

## Non-goals

- Implementing the adapter in this ADR
- Creating Google Cloud resources
- Automatic fulfillment on merge
- Broad Drive scopes

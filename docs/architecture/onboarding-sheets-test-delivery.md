# Onboarding Sheets test delivery

Agent G extension on integration PR #236. This is the interface Agent E mounts.
It does not edit `onboarding-execution-binding.ts` or the GHL adapters.

## Why a job kind was added

`executeCompanySheetsDeliveryJob` is the only Sheets writer. It previously
resolved the worksheet from a bound `CompanySheetsTabContract` (`campaign`,
`aged`, or `canary`) or from `campaign_test`, which writes the synthetic
campaign tab. `ClientOnboardingTestWorksheet` is a different row. Reusing
`campaign_test`, `lead`, or `canary` would send a 35-cell v3 row to the wrong
grid or reuse a production idempotency key.

`CompanySheetsDeliveryJob.kind` is an unconstrained string. The additive kind
is `onboarding_captured_test`. No migration was added. `campaign_test`,
`lead`, `aged_release`, and `canary` are unchanged.

The kind still uses the existing writer: company connection, `establishControl`,
worksheet lock, RAW + `INSERT_ROWS`, delivery job, and uncertain handling.
v3 keeps `delivery_row_id` at column 32 (header index 31), so reconciliation
for this kind reads that column. Other kinds still reconcile column A.
`releaseCompanySheetsDeliveryHold` refuses this kind, so the phrase cannot
clear `appendStartedAt` or the lock.

## Agent E wiring

Leave the fail-closed binding in place until both adapters are ready. Then
replace only the captured-test plugin options:

```ts
import { createOnboardingCapturedTestSheetsAppend } from "../services/company-sheets-delivery/onboarding-captured-test-append.js";
import { rereadOnboardingCapturedTestSheet } from "../services/client-onboarding-v2/onboarding-test-worksheet-reader.js";

sheets: createOnboardingCapturedTestSheetsAppend(),
rereadSheet: (sheet) => rereadOnboardingCapturedTestSheet(sheet),
```

The config plugin already calls `createOnboardingTestWorksheetHeaderReader()`.
`PUT .../onboarding/test-worksheet` accepts optional `spreadsheetId` and
`worksheetId`. The live reader returns null unless both are present, and it
reads that sheet id only. It does not choose the first tab or the saved
production worksheet.

`POST .../google-sheets/write-probe` sets `CompanySheetsDestination.writeReadiness`
to `verified` only when Drive `canEdit` is true on the bound campaign tab
after `establishControl`. A delivery job does not promote the field. A probe
of any other worksheet does not promote it. `canEdit: false` on the bound tab
returns `insufficient_capability` and stores `not_verified`. The readiness
gate `sheets_permission_probe` follows that field.

## Fail closed

- A Canary role, Canary schema, or four-cell Canary header never receives a
  35-cell row.
- Stats titles are not eligible.
- The live header must be the exact 35 v3 cells. A prefix, a blank grid, or a
  changed cell does not append and does not insert a header.
- The request spreadsheet and worksheet must equal this client's
  `ClientOnboardingTestWorksheet`. A mismatch does not retarget.
- Another client's destination spreadsheet is `tenant_mismatch`.
- An existing uncertain job or held `appendStartedAt` on that worksheet blocks
  another attempt.
- Keys must be `onboarding-test:{testRunId}:sheets`. Production prefixes are
  refused. `source_lead_event_id` stays the original event id.
- The job does not create a dispatch intent, a lead job, or an order evidence
  row, and it does not change campaign or aged switches.

## GO / NO-GO

**NO-GO** for controlled external testing. This branch does not call production
Google, does not enable flags, and leaves the mounted captured-test route on
the fail-closed port. Do not point the writer at a real spreadsheet from this
PR.

**GO** for Agent E to mount the port in a later integration pass and re-run the
local mock suite. External testing stays NO-GO until that mount is reviewed
and a human selects one approved test worksheet.

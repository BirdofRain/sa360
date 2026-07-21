# Inventory Explorer — Google Sheets summary-tab contract

**Status:** Required before enabling `INVENTORY_SHEETS_PROVIDER_ENABLED=true`.  
**Schema version:** `inventory-summary.v1` (Lead Processor aggregate export layout)

SA360 reads **aggregate inventory summaries only**. Raw lead rows (names, phones, emails, addresses, lead IDs, contact IDs) must never be fetched or parsed.

## Realistic generation path

The Lead Processor already emits this layout as a CSV/export (see committed fixtures in this folder). Operators can:

1. Run the existing aggregate inventory report for Truckers / Vet FEX, or
2. Paste/export that report into a dedicated Google Sheet tab named `Inventory Summary`.

Do **not** point SA360 at raw lead worksheets.

## Niche binding

| Niche key | Spreadsheet env | Typical Source Sheet label |
|---|---|---|
| `TRUCKER` | `INVENTORY_SHEETS_TRUCKER_SPREADSHEET_ID` | `Truckers` |
| `VET` | `INVENTORY_SHEETS_VET_SPREADSHEET_ID` | `Vet FEX` |

`niche_key` is assigned by SA360 configuration (spreadsheet ID → niche), not by a free-form cell, to prevent cross-niche contamination.

## Metadata block (required)

| Field | Example | Notes |
|---|---|---|
| Title | `Fast Lead Export Inventory Report` | Section marker |
| Version | `5.0.0` | `report_version` |
| Source Sheet | `Truckers` / `Vet FEX` | `source_sheet` |
| Started At | `7/20/2026` | becomes `generated_at` |
| Completed At | `7/20/2026` | becomes `completed_at` |
| Source Rows Available | integer | scan metadata |
| Rows Scanned | integer | scan metadata |

## Excluded counts (required section)

`Skipped / Excluded Summary` with rows such as:

- Previously Pulled Skipped
- Off-Limit Campaigns Skipped
- Duplicates Skipped
- Invalid Dates Skipped
- Invalid States Skipped

## Published totals (required)

`Bucket Totals` section:

| Lead Age Bucket | Available Leads |
|---|---|
| 1-3 months | n |
| 3-6 months | n |
| 6+ months | n |

These are the authoritative **published** national totals used for reconciliation.

## Mapped state table (required)

`State Breakdown` heading, then header + rows:

| Column | Alias accepted |
|---|---|
| `State` | `state` |
| `1-3 months` | `one_to_three_months` |
| `3-6 months` | `three_to_six_months` |
| `6+ months` | `six_plus_months` |
| `Total Available` | `total_available` |

- US states + DC codes are **mapped** for the territory map.
- Non US/DC codes in the same table are retained as **unmapped geography** (included in published totals, excluded from map shading).
- There is no separate optional unmapped table in v1; unmapped codes appear in the same State Breakdown and are classified by the parser.

## Reconciliation rules

1. Each row: `1-3 + 3-6 + 6+` must equal `Total Available`.
2. National: sum(mapped rows) + sum(unmapped rows) must equal published Bucket Totals per age bucket.
3. Duplicate geography codes → `INVALID` (accepted rows cleared).
4. Missing State Breakdown / header / empty mapped set → `INVALID`.
5. Valid reports with unmapped codes → `COMPLETE_WITH_WARNINGS`.
6. Invalid live data must **never** replace a valid cached snapshot.

## Prohibited columns / content

State Breakdown must not include PII or lead-level fields, including:

`first_name`, `last_name`, `full_name`, `phone`, `email`, `address`, `lead_id`, `contact_id`, `notes`

If sensitive headers appear in a recognized table header, validation fails.

## Tab naming

Default tab: `Inventory Summary`  
Override: `INVENTORY_SHEETS_SUMMARY_TAB`  
Read range (foundation): `'Inventory Summary'!A:E`

## Auth (when live client is implemented)

- Google **service account**
- Scope: `https://www.googleapis.com/auth/spreadsheets.readonly` **only**
- Share each spreadsheet with the service-account email
- Env: `GOOGLE_SHEETS_CLIENT_EMAIL`, `GOOGLE_SHEETS_PRIVATE_KEY` (escaped `\n` normalized server-side)
- Feature flag: `INVENTORY_SHEETS_PROVIDER_ENABLED=true` (exact)

## Safety

- Read-only client — no append/update/clear/batchUpdate methods
- Fallback order: Google Sheets → cached valid snapshot → committed CSV fixtures
- `canCreateOrder` / `canReserveInventory` / `canRequestQuote` remain false

## Live client status (foundation)

The foundation wires provider composition, parsing, cache, and the admin endpoint.  
The Google HTTP `values.get` client is still a **stub** until this summary tab is confirmed on live VET/Trucker workbooks and `googleapis` readonly access is added in a follow-up.

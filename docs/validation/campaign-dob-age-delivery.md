# Campaign DOB / age delivery

Read-only diagnosis for received date of birth and derived age on campaign
Sheets delivery. This note does not backfill, replay, or enable Alex Gross
delivery.

## Deployed revision

`GET https://sa360-sw6oq.ondigitalocean.app/health` on 2026-11-02 returned
`commitSha` `73eac95d75f8e10069cad1fd2d3152aa5a419591` (`73eac95`),
`buildSource` `SA360_BUILD_COMMIT_SHA`. That is the same commit as `master`
at the time of this change. The running API is the code this repair started
from.

## Missing production evidence

These reads were not available, so this is not a proven production root cause
and not a count of historical blank cells:

- DigitalOcean App Platform console or any other production Postgres session.
  The environment has no production `DATABASE_URL`. Local `DATABASE_URL` is
  the provisioned localhost database only.
- Datadog. The Datadog connection was not authenticated, so no request logs
  were read.
- A redacted `SourceLeadEvent` for `alex_gross`: original DOB key, JSON type,
  value, `sourceAttributes`, `unmappedSourceFieldsJson`, `lead_details`, and
  the published `company_sheets_campaign_custom_v1` Age / DOB targets.
- The VET Web Form cells already written for those events.

The last documented production observation of Alex's destination remains the
one in `docs/operations/google-only-pilot-preparation.md`: custom schema, 15
columns, published map, campaign dispatch paused. That observation did not
include a DOB key.

## Code path that blanks a cell

Campaign age used `new Date()` inside intake, so a replay was not tied to the
lead. The sheet mapper copied `lead_details.consumer_age` and did not derive
an age when that cell was blank. `dateOfBirth` / `birthDate` / `birthday` do
not normalize to `date_of_birth` or `birth_date`, so those answer keys missed
the registry even though the consumer-age policy already listed the camelCase
forms. A date-only value serialized as `YYYY-MM-DDT00:00:00.000Z` was a
datetime to the New York sheet transform and could move to the previous
calendar day. Aged-inventory parsing can turn a bare number such as an Excel
serial into a birthday; campaign delivery must not.

Custom question text is not a global alias. It is honored only through the
existing route `sourceFieldAliasOverridesJson` (`routeAliasOverrides`).

## Repair

- Reference rule `submitted_at_utc_date_else_received_at_utc_date`. Completed
  whole years use the UTC calendar date of `submitted_at`, then `receivedAt`.
  The worker clock is not a reference.
- DOB is stored and projected as `YYYY-MM-DD`. An ISO datetime keeps the date
  token before `T`.
- Supplied age never creates a DOB. Ages outside 18–86 still project. Excel
  serials stay on the aged-inventory parser only.
- `lead_details.consumer_age_provenance` is `supplied` or
  `derived_from_date_of_birth`. A disagreement sets
  `lead_details.consumer_age_conflict`. The Age cell keeps the supplied age.
  The DOB cell keeps the date. Preview adds
  `consumer_age_conflicts_with_date_of_birth`.
- Raw answer text stays on `sourceAttributes` or `unmappedSourceFieldsJson`.
  The original webhook body is not rewritten.

## Preview fields for Agent B

`preview.sheet.dobAge` and `customRowProjection(...).dobAge` use one object:

| Field | Meaning |
| --- | --- |
| `age` | Age cell before a column transform |
| `dateOfBirth` | Date-only `YYYY-MM-DD` |
| `dateOfBirthSheet` | `MM/DD/YYYY` for a DOB column whose transform is `date_america_new_york` |
| `ageProvenance` | `supplied`, `derived_from_date_of_birth`, or `missing` |
| `dateOfBirthProvenance` | `supplied` or `missing` |
| `derivedAge` | Whole years from the DOB at `referenceDate`, or blank |
| `referenceDate` | UTC `YYYY-MM-DD` used for that age |
| `referenceRule` | `submitted_at_utc_date_else_received_at_utc_date` |
| `conflict` | Supplied age and derived age both exist and differ |

The Admin C.O.C. UI is unchanged. Sheet `values` are still the cells that
would be written.

## Recoverable historical blanks

`assessCampaignDobAgeRecovery` classifies one stored normalized payload. It
does not write, call Google, or read production. Run it only against a local
or redacted export.

| Stored shape | Classification | Delivery without a backfill |
| --- | --- | --- |
| Canonical DOB, blank age | `derived_at_delivery` | Age cell fills from the reference date |
| `April 12, 1979` or `04/12/1979` on a supported alias, including unmapped | `derived_at_delivery` | DOB becomes `YYYY-MM-DD` and age is derived |
| `YYYY-MM-DDT00:00:00.000Z` | `derived_at_delivery` | Calendar date is kept |
| Age present, no DOB | `age_only` | Age cell kept, DOB stays blank |
| Supplied age disagrees with DOB | `conflict_visible` | Both cells kept, preview flag set |
| Supported alias with an unparseable value | `invalid_evidence` | Stays blank. Raw text remains on the attribute |
| Custom question whose text is not on the route alias list | `needs_source_alias` | Stays blank until that source-scoped alias is configured. Not replayed here |
| Object-typed DOB | not stored | Not projected. No production payload of this type was read |

A production count requires the missing event export above. Do not infer that
count from the fixture classifications.

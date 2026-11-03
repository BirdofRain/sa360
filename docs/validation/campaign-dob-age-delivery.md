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

- Reference rule `submitted_at_utc_date_else_received_at_utc_date`. The first
  valid documented timestamp wins. `submitted_at` is used only when it
  parses. A nonempty invalid value stays on `source_intake.submitted_at`
  and does not block the stored event `receivedAt`. Intake writes that
  receipt once, then passes the same value into normalization. Preview,
  delivery, and reconcile pass that stored value again. The worker clock
  is not read again on retry.
- DOB is stored and projected as `YYYY-MM-DD`. A documented datetime
  (`YYYY-MM-DDTHH:mm[:ss[.fraction]](Z|±HH:mm)`) keeps the written date
  token. A malformed suffix is not a DOB; the raw answer stays on
  `sourceAttributes`. A DOB after the reference date is kept and age is
  not derived (`ageUnavailableReason: future_date_of_birth`). When neither
  reference is valid, the DOB is kept and
  `ageUnavailableReason` is `no_valid_reference`.
- Supplied age never creates a DOB. Ages outside 18–86 still project. Excel
  serials stay on the aged-inventory parser only.
- `lead_details.consumer_age_provenance` is `supplied` or
  `derived_from_date_of_birth`. A disagreement sets
  `lead_details.consumer_age_conflict`. The Age cell keeps the supplied age.
  The DOB cell keeps the date. Preview adds
  `consumer_age_conflicts_with_date_of_birth`.
- Raw answer text stays on `sourceAttributes` or `unmappedSourceFieldsJson`.
  The original webhook body is not rewritten.

## Receipt time

`processLeadCaptureIoWebhookIntake` inserts `SourceLeadEvent.receivedAt`
before it normalizes. That same instant is the normalizer's `receivedAt`.
Next-gen promotion and one-event reconcile pass the row's stored
`receivedAt`, not a new clock. A DOB-only body with no `submitted_at`
stores `lead_details.date_of_birth` and the derived `consumer_age` from
that receipt. Later preview and row projection receive
`event.receivedAt`. They do not call `new Date()`.

## Route aliases and already stored answers

Preview (`planCustomCampaignSheet`) and the campaign/custom writers
(`companySheetsCampaignRowValues`, `customRowProjection`) do not load
`sourceFieldAliasOverridesJson`. They read the stored normalized payload
only. Configuring a route alias after the event is stored does not change
an unmapped answer, and it does not fill Age or DOB.

`assessCampaignDobAgeRecovery({ routeAliasOverrides })` can classify that
answer as derivable. That helper is not on the preview or writer path.
Calling it with overrides is not evidence that a sheet cell will fill.

If the alias already existed when `persistRoutingAndDuplicate` ran,
enrichment copies the answer onto `sourceAttributes` under the canonical
key and removes it from the unmapped list. The writer then sees that
stored attribute. It still does not read the alias. `lead_details` is not
recomputed during that copy; a blank age is derived at projection from
the stored attribute and the persisted receipt.

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
| `ageUnavailableReason` | `null`, `no_valid_reference`, or `future_date_of_birth` |

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
| Custom question whose text is not already a stored canonical attribute | `needs_source_alias` | Stays blank. Preview and the sheet writer do not read route alias settings |
| Object-typed DOB | not stored | Not projected. No production payload of this type was read |

A production count requires the missing event export above. Do not infer that
count from the fixture classifications.

## Scoped incoming `date`

`date` is not a global date-of-birth alias. Existing LeadCapture fixtures use
it as the legacy submission calendar together with `time`. The confirmed
next-gen veteran form (`leadcapture_io` / `leadcapture_io_nextgen`, SourceFunnel
`cmv8k6uui00q0lc0uyto17ld1`, or the exact page
`go.lifeinsuranceforvets.com/learn-julia-dodge`) maps `date` to
`date_of_birth` before the existing DOB parser runs. A different funnel id
does not fall through to that page. Julia's healthcare-worker page is a
different path and is not mapped. CamelCase aliases such as `dateOfBirth` now
normalize to `date_of_birth` before lookup.

`pnpm source-intake:dob-recovery` is a dry run against localhost only. It
refuses `--apply` and any remote database host. It reports eligible,
unchanged, conflicting, invalid, and skipped counts for the confirmed form,
and a separate census of every LeadCapture form that retained a raw `date`
with a missing canonical DOB or age. Only the confirmed form has
`dateMeansBirthday`. Already-delivered rows are flagged because updating
SA360 would not rewrite a spreadsheet or GHL value that was already sent.
The command does not write. A localhost count is not a production total.

`pnpm source-intake:dob-recovery-admin` is a separate GET-only reader for
`/admin/v1/source-leads`. It pages the newest-first list until the window
start is crossed, then reads each in-window detail plus the known event. It
does not see Sheets jobs or lead allocations, so those two flags stay
unresolved. It refuses write flags and a non-HTTPS host.

When a GHL destination map selects Age or DOB, the source-attribute stamp
uses `projectCampaignDobAge` on the lifecycle payload. Age sends the
canonical consumer age, including `lead_details.consumer_age`. DOB sends
`YYYY-MM-DD`. A supplied age that disagrees with the DOB is still the value
that is sent. The stamp does not enable delivery or change the destination.
The onboarding note still does not calculate age. Occupation, coverage type,
and beneficiary relationship stay unmapped; the original answers remain on
the raw payload.

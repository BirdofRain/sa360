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

`date` is not a global date-of-birth alias, and it is not mapped on
`UNKNOWN_ROUTE`. The reusable registry is `SCOPED_INCOMING_FIELD_BINDINGS`.
A binding maps `date` to `date_of_birth` only when that form is explicitly
confirmed. `SourceFunnel.id` and the LeadCapture funnel UUID
(`providerFunnelId`) are different identifiers. A binding that names an
internal id rejects every other internal id and does not fall through to its
page. A non-UUID internal id that is not one of the recorded SourceFunnel ids
is unverified, so the exact page may still match. A UUID is a LeadCapture
funnel id, not a SourceFunnel id. When that UUID is supplied and it is not
the recorded provider funnel id, the page does not match. Two confirmed
forms that disagree, such as Julia's internal id on Eriks's page, match
neither form. Tracking queries are ignored. A path prefix does not match.
Healthcare pages are not included unless they are separately confirmed.

Confirmed `date` means birthday (`leadcapture_io` / `leadcapture_io_nextgen`):

| Client page | Internal SourceFunnel id | External LeadCapture funnel | Birthday JSON key | Status |
| --- | --- | --- | --- | --- |
| `go.lifeinsuranceforvets.com/learn-julia-dodge` | `cmv8k6uui00q0lc0uyto17ld1` | `b002eb13-43cc-4d90-99fd-e23bc02ac822` | `date` on the DOB step; upstream target `date_of_birth` | supported before this inventory |
| `go.lifeinsuranceforvets.com/learn-eriks-veidemanis` | not verified; do not invent one | `c12cf351-0bc4-4127-8786-50a67643eadb` | `date` on the DOB step; upstream target `date_of_birth` | supported before this inventory |
| `go.lifeinsuranceforvets.com/learn-alex-gross` | not verified; do not invent one | `68d9c95b-e186-4c99-8fc9-5b86b17d8eee` | `date` on the DOB step | added from public form config |
| `go.lifeinsuranceforvets.com/learn-jean-perez` | not verified; do not invent one | `181b0e69-fd55-44e3-be68-a284c96435b0` | `date` on the DOB step | added from public form config |
| `healthcareworker.familylegacyprotection.com/learn-andru-duranso` | not verified; do not invent one | `18c28feb-5c3d-4bd0-94d8-1ed33a6fa718` | `date` on the DOB step | added from public form config |
| `healthcareworker.familylegacyprotection.com/learn-alex-feuerstein` | not verified; do not invent one | `22ac7ad2-97a3-4fce-bd4d-02124b6e4520` | `date` on the DOB step | added from public form config |

The Eriks example source lead `e452eaed-92c8-4916-9dd1-fbd001dafaac` is a
provider lead id, not a `SourceLeadEvent` id. Its raw `date` is `01/27/1949`
and its `submitted_at` is `2026-11-03T09:53:33.092Z` (4:53 AM America/New_York).
The canonical DOB is `1949-01-27` and the age at that submission is 77. That
lead arrived before the Julia-only release and stays historically blank until
a separate correction runs.

Other LeadCapture forms found only as repository fixtures are not guessed
from the veteran domain, an old-looking date, or `submitted_at` alone.
Production `SourceFunnel` rows and `SourceLeadEvent` rows were not readable
from this environment. Local `127.0.0.1` database `sa360` had zero
`SourceFunnel`, `SourceLeadEvent`, and `CampaignRoutingRule` rows, so it is
not a live inventory. Receiving clients are not inferred from a page name.

Public form config was read with `GET https://my.leadcapture.io/api/public/funnels/{embedKey}?mf=1`
for pages whose published HTML embeds `https://my.leadcapture.io/embed.min.js`.
The embed key is not a provider funnel UUID and is not stored on a binding.
The external id in the confirmed table is `funnel.id` from that response. Eriks's value matches the
UUID already released. Julia's UUID was missing from the released binding, so
a payload that sent it was treated as an unknown funnel and did not match.
Alex and Jean use the same DOB step shape: the step is named `DOB`, the field
type is `date`, and `webhookFieldName` is `date`. No stored event was read, so
the JSON value type on the wire is not claimed from production.

| Page or fixture | Birthday key in the accessible evidence | Status |
| --- | --- | --- |
| `learn-madison-pimentel` | public step `Sex/ DOB` webhooks `date_of_birth` (`f2cca061-4b70-4a0f-b201-2cf8b4b03c6f`) | explicit key already supported; `date` is not bound |
| `learn-julia-healthcare-worker` | public page returned 404 | not an active page |
| `learn-nicholas-dambruoso` | public page has no LeadCapture embed; repository fixture has no birthday field | unverified; `date` is not bound |
| James Torrey route `LCIO_LEGACY_VET_LIFE_JAMES_TORREY_VET_FEX` | retained fixture `date` + `time`; public funnel `d6f2157f-d612-441a-80af-88742ef084dc` has an Age step whose webhook is `number`, not a birthday `date` | submission calendar stays; `number` is not bound |
| `example.test/nurse-nextgen-canary` | fixture `date_of_birth` | synthetic fixture, not a live form |
| `example.test/vet-fex-nextgen` | fixture `date` of `2026-06-12` | synthetic fixture; not mapped |

These registry additions do not rewrite stored events or spreadsheet cells.
No LeadCapture form, outgoing webhook body, or Zap needs to change for the
pages added here: the existing `date` answer is mapped internally. Madison
already sends `date_of_birth`. A later read-only export is still required for any
configured `SourceFunnel` or active campaign rule that was not on one of the
public pages above, including its parent URL, provider funnel UUID, internal
`SourceFunnel.id`, source system, the form step that shows what `date` means,
and whether a stored event already has canonical DOB and age. Do not paste
raw personal information into that export.

Upstream LeadCapture change, for every confirmed page: the outgoing JSON key
for the birthday answer is `date_of_birth`, and the outgoing JSON key for the
submission timestamp is `submitted_at`. A visible question label is not that
key. Old payloads remain readable. This repository does not edit live forms.

CamelCase aliases such as `dateOfBirth` now normalize to `date_of_birth`
before lookup. Spreadsheet preview, Sheets rows, portal age, and ordinary
GHL Age/DOB stamps read the canonical projection. They do not fall back to a
raw `date`.

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

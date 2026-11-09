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
| `go.lifeinsuranceforvets.com/learn-5428` | `cmw090p2c012skm0u1ku2cokp` | `96b80928-a16d-491b-a8f7-f3528becf567` | `date` on the DOB step. LeadCapture names the funnel Tori Haskell. No receiving client is stored on the binding | added after the public form and stored event `cmw15zx850001kq0uvcbyxht0` |
| `go.lifeinsuranceforvets.com/learn-nick-agents` | `cmw0knqfk01ntkm0uorv5xrl7` | `006e7d56-604f-4d19-a273-3044dcf143f2` | `date` on the DOB step. This is not `learn-nicholas-dambruoso` | added after the public form and stored event `cmw0knqfy01nukm0uz9mrjzqo` |
| `go.lifeinsuranceforvets.com/learn-rob-arden` | `cmubqp3qv07htm00v2eva4jdl` | `c5e832d0-ef1b-4837-960c-d312f7ebbd2b` | `date` on the DOB step | added after the public form and stored event `cmw189sti008mkq0ujinyz8w1` |
| `go.lifeinsuranceforvets.com/learn-vernon-baker` | `cmuebit920awam00v7kheh6au` | `5d0892ee-b3a1-45a3-a111-bcd3065e394b` | `date` on the DOB step | added after the public form and stored event `cmw181rww0088kq0uxiwu79np` |
| `go.lifeinsuranceforvets.com/learn-daniel-gvili-new` | `cmubzdlct07vcm00v0ca90xhq` | `dd056ca1-dbf1-40af-8eb9-563281a80b8d` | `date` on the DOB step. `learn-daniel-gvili` is a different page and is not bound | added after the public form and stored event `cmw17tj2a007skq0uo8jh1w67` |
| `go.lifeinsuranceforvets.com/learn-jacob-zapata` | `cmubr493407ivm00v401jrwc8` | `e8d5cef4-5713-4000-8313-bb141ef1fbbd` | `date` on the DOB step | added after the public form and stored event `cmw178rkh0066kq0uif87sbkt` |
| `go.lifeinsuranceforvets.com/learn-dom-scalice` | `cmtwbyi5v00d1j50uf933qfsc` | `d4d275e1-ce6a-4856-8ae4-ae9c7ce9ab38` | `date` on the DOB step | added after the public form and stored event `cmw1777by005skq0u4ij8cchb` |
| `go.lifeinsuranceforvets.com/learn-james-laird` | `cmvcejoyo01nzjh0u0jh07us0` | `aa7e4196-c8f8-4f84-abc0-5526f903460e` | `date` on the DOB step | added after the public form and stored event `cmw18v7oy000pg70uo27ez6r7` |
| `go.lifeinsuranceforvets.com/learn-ryan-wooldridge` | `cmtwxk42200vcj50usrthhi2e` | `39d7cc47-07f9-47ca-b3a3-2c421bd0cdb9` | `date` on the DOB step. No receiving client is stored on the binding | added after the public form and stored events `cmtwxk42g00vdj50unl30y9l7` and `cmu2f7pxa00miiu0uts1gsv8p` |
| `go.lifeinsuranceforvets.com/learn-robby-wells` | `cmuo20w7c02tvdz0vf6luhl8d` | `f422264d-acc5-40fd-b82d-f9462db19f27` | `date` on the DOB step. The typo host `go.lifeinsuranceforvet.com` is not this page | added after the public form and stored events `cmuo20w7t02twdz0vc97j50wo` and `cmuux2dro05zcjn0vqhc9lrjt` |

These added bindings do not set a receiving client, change a source association, or enable delivery. A stored slash-shaped `date` is not enough by itself. Each added page has a public step named `DOB` whose `webhookFieldName` is `date`, and a stored event on that exact parent whose raw `date` did not become a canonical DOB.

Ryan Wooldridge and Robby Wells were opened after that first pass. Their raw `parent_url` normalizes to the exact page and their raw birthday key is `date`. The stored normalized `parent_url_key` on those older events is empty; this binding applies to a new intake of that raw shape and does not rewrite the stored events. The typo host `go.lifeinsuranceforvet.com/learn-robby-wells` stays unbound.

The catalog pass adds every other live page whose public DOB step webhooks `date` or, for the two self-employed forms, `date_copy`, and whose catalog `SourceFunnel` id matches that page. A missing production DOB is not required. Louie Mezzone (`cmw19ikp1002ng70u84bqx9on`) and Michael Coulter (`cmw195f4x001vg70uch6dcxty`) did send `date` with no canonical DOB. Jordan Montero's public step webhooks `date`, while stored event `cmw18wo540013g70u61affdvx` used `date_of_birth` and already stored a canonical DOB. The `date` alias is configuration evidence; that event did not exercise it. `learn-andrew-hearn` and `my.leadcapture.io/p/6khoj2_q` embed the same funnel as the nurse Julia page (`5164ed76-dadf-40ac-b148-1863f52c0e1a`). Each page keeps its own source id. No receiving client is assigned. `learn-sam-test` has the same DOB step. Its public step is named `DOB`, the field type is `date`, and `webhookFieldName` is `date` on funnel `5b6959bf-5e41-4508-a802-500f0cc9279b`. The confirmed source is `cmvpb65gf004hi70u6hphb3zu`. A page-scoped `date` binding fills canonical DOB and derived age for a new intake. It does not select a client, change a routing rule, or enable delivery.

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
| `learn-madison-pimentel-634632` | same embed and funnel as Madison; webhook `date_of_birth` | `date` is not bound |
| `learn-179930` | public Age step webhooks `age` | global age alias; `number` is not bound |
| `go.lifeinsuranceforvets.com/learn` | James Torrey legacy parent; stored event sends `age` and calendar `date` | calendar `date` is not bound |
| `go.lifeinsuranceforvet.com/learn-robby-wells` | typo host does not resolve; never-seen confirmed row is a different source | not bound |
| `my.leadcapture.io/p/6rci-usi` | public page returned 404 | unresolved |
| provider funnel `d0e009dc-d23a-4670-a7f5-fb4a95138ba7` | public funnel API returned 404 | unresolved |
| `learn-julia-healthcare-worker` | public page returned 404 | not an active page |
| `learn-nicholas-dambruoso` | public page has no LeadCapture embed. Stored event `cmw0wckts0086jv0tcsbrkrvr` sent `date_of_birth` plus a calendar `date` | explicit `date_of_birth`; calendar `date` is not bound |
| `learn-731462` | public funnel `97c24cee-0530-41db-b4d6-20981ca32397` is James Torrey Age + OTP. The Age field's webhook name is empty | incoming age key is not confirmed |
| `learn-daniel-gvili` | page has no LeadCapture embed. `learn-daniel-gvili-new` is the bound page | DOB key on this older page is not confirmed |
| `learn-ben-stephens` | page has no LeadCapture embed and the catalog row has not been seen | field meaning is not confirmed |
| `learn-sam-test` | public DOB step webhooks `date` on funnel `5b6959bf-5e41-4508-a802-500f0cc9279b`, source `cmvpb65gf004hi70u6hphb3zu` | scoped `date` binding for new intake. Stored event `cmvpb65h0004ii70unzjwhtq0` (October 26, 2026 9:44 AM America/New_York) kept a raw `date` and a blank canonical DOB. The preview does not rewrite that snapshot |
| `go.selfemployedhi.com/chandler-bigagency` and `zach-busch` | DOB step webhooks `date_copy`, not `date` | `date_copy` is bound; plain `date` is not |
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

## Confirmed LeadCapture inventory, November 9, 2026

Read-only against the deployed API at `7f7c5075415ff712a40bbc672d0e1d8e70152a48`. Fifty-five confirmed `leadcapture_io` sources were paged. Every confirmed row has an empty `providerFunnelId` column. Provider UUIDs below are the registry values taken from public form config, and the matcher was run locally against each source id and page with that empty column. Eleven `CampaignRoutingRule` rows exist. None of the active rules use a confirmed page or a stored provider UUID as `campaignId` or `formId`. Client association is not a field-semantics match.

Since the November 3, 2026 6:29 PM America/New_York intake release, 2,013 LeadCapture events were counted. Raw top-level `date` appeared 725 times, `DATE` zero times, and `date_of_birth` 615 times. `answers.date` appeared 422 times. `form.date` and `questions`, `custom_questions`, and `customQuestions` appeared zero times. No custom-question container was added.

The blank canonical snapshot is event `cmvpb65h0004ii70unzjwhtq0`, received October 26, 2026 9:44 AM America/New_York, source system `leadcapture_io_nextgen`, route `UNKNOWN_ROUTE`. Its birthday answer is the top-level string `date` in slash-date form. There is no `date_of_birth`, no `funnel_id`, and no question container. `lead_details` kept `beneficiary` and `coverage_amount` only. The page had no scoped binding, so intake left DOB and age blank. The preview for that client currently selects the later event `cmw9ouzov0219jo0u4lvjt7qp` (November 9, 2026 3:03 PM America/New_York), whose raw key is already `date_of_birth` and whose stored canonical DOB is filled. Preview reads that stored payload and does not re-normalize the October 26 raw `date`. A future intake that sends `date` now matches `leadcapture_io_nextgen_vet_sam_test`. The October 26 row is unchanged and needs a separate recovery if it is ever corrected.

Four other confirmed pages already have a `date` binding, but their newest stored event is still an older raw `date` with a blank canonical DOB and a null stored binding: Ryan Okeefe `cmv75aeye0fcskq0ttc2zyymi` (October 13, 2026 4:40 PM America/New_York), Nick Richmond `cmvgshcff0029kd0utnefpffp` (October 20, 2026 10:39 AM America/New_York), Jean Perez `cmveckir906qdjh0umdm80i8i` (October 18, 2026 5:38 PM America/New_York), and Jake Donnelly `cmv6n56xu0e3jkq0twx8k38ap` (October 13, 2026 8:12 AM America/New_York). Those snapshots stay blank in preview until a separate recovery. Madison's latest event also has raw `date` and a blank canonical DOB; `date` stays unbound there because the public step webhooks `date_of_birth`.

| Source id | Page | Registry provider UUID | Latest system | Observed birthday key on the newest event | Registry match | Newest canonical |
| --- | --- | --- | --- | --- | --- | --- |
| `cmtw4dn3p0002j50u3fj237b6` | `healthcareworker.familylegacyprotection.com/learn-trey-tyree` | `898d1946-ee60-4da4-b4b4-ceac96724266` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_trey_tyree` alias `date` | DOB, age |
| `cmtw50cn10022j50uppu0xe86` | `go.lifeinsuranceforvets.com/learn-marcus-turo` | `69504d6d-7b9b-4e5e-82af-2ef5754049e4` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_marcus_turo` alias `date` | DOB, age |
| `cmtw5jm4g003vj50uryi4b84b` | `healthcareworker.familylegacyprotection.com/learn-michael-fediw` | `0ce82c35-20cc-4053-8606-af344387e932` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_michael_fediw` alias `date` | DOB, age |
| `cmtw7ie4v005xj50uyrxa6j9d` | `healthcareworker.familylegacyprotection.com/learn-alex-feuerstein` | `22ac7ad2-97a3-4fce-bd4d-02124b6e4520` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_alex_feuerstein` alias `date` | DOB, age |
| `cmtw8tgc4008hj50u998vl8ms` | `healthcareworker.familylegacyprotection.com/learn-andrew-hearn` | `5164ed76-dadf-40ac-b148-1863f52c0e1a` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_nurse_andrew_hearn` alias `date` | no submission |
| `cmtw96s120090j50uaohj8vff` | `go.lifeinsuranceforvets.com/learn-domenic-boselli` | `bef47ea9-a089-47f4-b6bc-3512983eb84e` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_domenic_boselli` alias `date` | DOB, age |
| `cmtw9ruyt0094j50u5hzd6r1u` | `healthcareworker.familylegacyprotection.com/learn-andru-duranso` | `18c28feb-5c3d-4bd0-94d8-1ed33a6fa718` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_andru_duranso` alias `date` | DOB, age |
| `cmtwbyi5v00d1j50uf933qfsc` | `go.lifeinsuranceforvets.com/learn-dom-scalice` | `d4d275e1-ce6a-4856-8ae4-ae9c7ce9ab38` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_dom_scalice` alias `date` | DOB, age |
| `cmtx512kk000wmp0uzhh5hubt` | `my.leadcapture.io/p/dn_omzoj` | `5a26bb9d-1dcf-4dc0-9202-44a62a941975` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_hosted_madison_v2` alias `date` | no submission |
| `cmu6wgqj302d2m00vnpz58inh` | `healthcareworker.familylegacyprotection.com/learn-julia-dodge` | `5164ed76-dadf-40ac-b148-1863f52c0e1a` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_julia_dodge` alias `date` | DOB, age |
| `cmubndr0b07frm00vb4dv25bh` | `go.lifeinsuranceforvets.com/learn-reid-mazzuco` | `26a47233-753e-4162-8fac-76ac5502bf35` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_reid_mazzuco` alias `date` | DOB, age |
| `cmubq406c07hkm00votxure0d` | `go.lifeinsuranceforvets.com/learn-madison-pimentel` | none | leadcapture_io_nextgen | date:slash_date | none | no DOB, no age |
| `cmubqp3qv07htm00v2eva4jdl` | `go.lifeinsuranceforvets.com/learn-rob-arden` | `c5e832d0-ef1b-4837-960c-d312f7ebbd2b` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_rob_arden` alias `date` | DOB, age |
| `cmubr358c07iom00vpy7vk7mp` | `go.lifeinsuranceforvets.com/learn-marissa-preslar` | `bcba7b64-3b2a-4767-a547-7fc7c5a78b23` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_vet_marissa_preslar` alias `date` | no submission |
| `cmubr493407ivm00v401jrwc8` | `go.lifeinsuranceforvets.com/learn-jacob-zapata` | `e8d5cef4-5713-4000-8313-bb141ef1fbbd` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_jacob_zapata` alias `date` | DOB, age |
| `cmubrjexo07jjm00vkl5887x9` | `go.lifeinsuranceforvets.com/learn-ryan-okeefe` | `5a909ecf-dc08-484b-958f-efe4532e5ffc` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_ryan_okeefe` alias `date` | no DOB, no age |
| `cmubrx6ho07kkm00v85r2evau` | `go.lifeinsuranceforvets.com/learn-matt-wilson` | `573ba578-f5d5-4d92-9319-9712eee7a503` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_vet_matt_wilson` alias `date` | no submission |
| `cmubsvmp407m2m00vcu75e34l` | `go.lifeinsuranceforvets.com/learn-nick-richmond` | `80b7cd3c-0f81-4c3b-b972-4360dff70029` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_nick_richmond` alias `date` | no DOB, no age |
| `cmubu9sto07nlm00vearmlnup` | `go.lifeinsuranceforvets.com/learn-michael-coulter` | `3ce8467f-2a3b-407b-a9dd-494b7f05dc02` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_michael_coulter` alias `date` | DOB, age |
| `cmubub4l207nrm00vbihrzt5s` | `go.lifeinsuranceforvets.com/learn-caleb-farina` | `a361494a-c698-4c64-8501-d3528e7ee5b4` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_caleb_farina` alias `date` | DOB, age |
| `cmubvgmeo07pmm00v6q8omc8m` | `go.lifeinsuranceforvets.com/learn-jean-perez` | `181b0e69-fd55-44e3-be68-a284c96435b0` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_jean_perez` alias `date` | no DOB, no age |
| `cmubvzbjg07pzm00vr9szpicc` | `go.lifeinsuranceforvets.com/learn-dom-green` | `8e1e24c0-01d0-4ddf-ae88-bb0e560d501e` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_vet_dom_green` alias `date` | no submission |
| `cmubzdlct07vcm00v0ca90xhq` | `go.lifeinsuranceforvets.com/learn-daniel-gvili-new` | `dd056ca1-dbf1-40af-8eb9-563281a80b8d` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_daniel_gvili` alias `date` | DOB, age |
| `cmuc2n4d1084jm00v5jpeva93` | `go.lifeinsuranceforvets.com/learn-louie-mezzone` | `016f5ddb-499b-412b-987e-5e0e50f70012` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_louie_mezzone` alias `date` | DOB, age |
| `cmuc2z56g085bm00vcn3eki25` | `go.selfemployedhi.com/chandler-bigagency` | `f4e7acac-a55e-4cfe-963c-f992edf0dccb` | leadcapture_io_nextgen | date_copy:slash_date | `leadcapture_io_nextgen_sehi_chandler_conrad` alias `date_copy` | DOB, age |
| `cmuc51ou10896m00v55041omy` | `go.lifeinsuranceforvets.com/learn-andrew-walters` | `d83b52ea-6443-42cc-9ba3-967f98a3c47e` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_andrew_walters` alias `date` | DOB, age |
| `cmucy27qs0906m00vz99w0z30` | `go.lifeinsuranceforvets.com/learn-jake-donnelly` | `5cf9f74a-52fb-4207-b7ac-b491b8602e11` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_jake_donnelly` alias `date` | no DOB, no age |
| `cmuebit920awam00v7kheh6au` | `go.lifeinsuranceforvets.com/learn-vernon-baker` | `5d0892ee-b3a1-45a3-a111-bcd3065e394b` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_vernon_baker` alias `date` | DOB, age |
| `cmueeuvki0b1tm00vyyl4d4et` | `go.selfemployedhi.com/zach-busch` | `168f00d0-99a5-44bb-9356-bf5129b69393` | leadcapture_io_nextgen | date_copy:slash_date | `leadcapture_io_nextgen_sehi_zach_busch` alias `date_copy` | DOB, age |
| `cmumqxxif0101dz0vlg8ufjcv` | `my.leadcapture.io/p/2jhvao_r` | `898d1946-ee60-4da4-b4b4-ceac96724266` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_hosted_trey_tyree` alias `date` | no submission |
| `cmun0lx5001ejdz0v7syapnih` | `my.leadcapture.io/p/046y3ex0` | `bef47ea9-a089-47f4-b6bc-3512983eb84e` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_hosted_domenic_boselli` alias `date` | no submission |
| `cmun0ozod01f3dz0vczqa9lvr` | `go.lifeinsuranceforvets.com/learn-daniel-gvili` | none | leadcapture_io_legacy | answers.date:other_string; answers.date_of_birth:other_string | none | DOB, age |
| `cmun2rdwu01ikdz0v9n8nc955` | `go.lifeinsuranceforvet.com/learn-robby-wells` | none | leadcapture_io_nextgen | (no event) | none | no submission |
| `cmuqyxotq010ljn0v2gqvsfir` | `go.lifeinsuranceforvets.com/learn-eriks-veidemanis` | `c12cf351-0bc4-4127-8786-50a67643eadb` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_eriks_veidemanis` alias `date` | DOB, age |
| `cmuqzbbkr010zjn0vur4cmirs` | `my.leadcapture.io/p/iexkkbgh` | `c12cf351-0bc4-4127-8786-50a67643eadb` | leadcapture_io_nextgen | (no event) | `leadcapture_io_nextgen_hosted_eriks_veidemanis` alias `date` | no submission |
| `cmux10kqb00kcqa0v4j41m19a` | `go.lifeinsuranceforvets.com/learn-nicholas-dambruoso` | none | leadcapture_io_legacy | answers.date:other_string; answers.date_of_birth:other_string | none | DOB, age |
| `cmux1wrzs00lqqa0vm3wao5f9` | `go.lifeinsuranceforvets.com/learn-ben-stephens` | none | leadcapture_io_nextgen | (no event) | none | no submission |
| `cmuyb816k001xkt0tyrs7n0g5` | `go.lifeinsuranceforvets.com/learn-731462` | none | leadcapture_io_nextgen | age:digit_string | none | no DOB, age |
| `cmv8k6uui00q0lc0uyto17ld1` | `go.lifeinsuranceforvets.com/learn-julia-dodge` | `b002eb13-43cc-4d90-99fd-e23bc02ac822` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_julia_dodge` alias `date` | DOB, age |
| `cmvb8xfu400o8jo0ubeqesm76` | `healthcareworker.familylegacyprotection.com/learn-jackson-randall` | `fb917dcc-6887-4123-a74e-8bf00f1199a3` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_jackson_randall` alias `date` | DOB, age |
| `cmvcejoyo01nzjh0u0jh07us0` | `go.lifeinsuranceforvets.com/learn-james-laird` | `aa7e4196-c8f8-4f84-abc0-5526f903460e` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_james_laird` alias `date` | DOB, age |
| `cmvdxmnxx058pjh0uaogzn17w` | `healthcareworker.familylegacyprotection.com/learn-josh-petley` | `3af72d73-b35e-459b-9048-20b9b2d8e0c8` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_josh_petley` alias `date` | DOB, age |
| `cmvdy0ra705adjh0ucqwkrtbs` | `healthcareworker.familylegacyprotection.com/learn-abdel-zubi` | `07ac67a6-8bd0-4cc8-8605-3224ed6bab18` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_abdel_zubi` alias `date` | DOB, age |
| `cmvdy4dz705aojh0umifpvzjk` | `healthcareworker.familylegacyprotection.com/learn-simon-marte` | `f3e79e12-1b05-493b-a7a0-4d67499559c1` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_simon_marte` alias `date` | DOB, age |
| `cmvehzsfq07fhjh0u20pk617w` | `go.lifeinsuranceforvets.com/learn-logan-carlisle` | `14ad9c9a-7558-43c9-9a95-ffb37630ed59` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_logan_carlisle` alias `date` | DOB, age |
| `cmvfrw9jv003xmv0ueo9n3ikn` | `healthcareworker.familylegacyprotection.com/learn-domenic-boselli` | `345daf8b-1381-48c1-88d7-d77545d66ff3` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_domenic_boselli` alias `date` | DOB, age |
| `cmvi7ujpi02dvgt0vivze782r` | `healthcareworker.familylegacyprotection.com/learn-michael-panza` | `c5121b9f-20b3-4eb8-ac6a-59cf6e8d2264` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_michael_panza` alias `date` | DOB, age |
| `cmvlfkdnf007ckg0uymx2c113` | `healthcareworker.familylegacyprotection.com/learn-jordan-montero` | `30449bc9-5987-4a3f-9ffd-f2ec81350ac0` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_jordan_montero` alias `date` | DOB, age |
| `cmvlfqleb007nkg0u9lsw8wlz` | `healthcareworker.familylegacyprotection.com/learn-daniel-saenz` | `2d8dbf90-3f7f-4ea5-9135-bf0f5667ecfb` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_daniel_saenz` alias `date` | DOB, age |
| `cmvlhd9gq00e1kg0u300lar2j` | `go.lifeinsuranceforvets.com/learn-matt-mandeville` | `50d5488d-cd21-4e20-8034-8d539d8ba74d` | leadcapture_io_nextgen | date:slash_date | `leadcapture_io_nextgen_vet_matt_mandeville` alias `date` | DOB, age |
| `cmvlhdwmn00e3kg0ut2xyqpzl` | `go.lifeinsuranceforvets.com/learn-alex-gross` | `68d9c95b-e186-4c99-8fc9-5b86b17d8eee` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_vet_alex_gross` alias `date` | DOB, age |
| `cmvpb65gf004hi70u6hphb3zu` | `go.lifeinsuranceforvets.com/learn-sam-test` | `5b6959bf-5e41-4508-a802-500f0cc9279b` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_vet_sam_test` alias `date` | DOB, age |
| `cmvxwnuoc05icm40uwf7bd69k` | `healthcareworker.familylegacyprotection.com/learn-aleksandre-vayshelboym` | `0417fe5a-97fd-4833-a897-4b490147aaae` | leadcapture_io_nextgen | date_of_birth:slash_date | `leadcapture_io_nextgen_nurse_aleksandre_vayshelboym` alias `date` | DOB, age |
| `cmw3hj4ir0dcwk10u3s9g44rf` | `healthcareworker.familylegacyprotection.com/learn-evan-marukos` | none | leadcapture_io_nextgen | date_of_birth:slash_date | none | DOB, age |
| `cmw3i40ag0djok10u0108jw8f` | `go.lifeinsuranceforvets.com/learn-ron-dorah` | none | leadcapture_io_nextgen | date_of_birth:slash_date | none | DOB, age |

Sources with a registry match and no stored event yet: Andrew Hearn, hosted Madison `p/dn_omzoj`, Marissa Preslar, Matt Wilson, Dom Green, hosted Trey `p/2jhvao_r`, hosted Domenic `p/046y3ex0`, and hosted Eriks `p/iexkkbgh`. The binding is ready for a new intake. There is no submission to confirm the live key.

Unmatched confirmed pages, left unchanged: Madison Pimentel (`date` is not the birthday webhook); the older Daniel Gvili page (newest event has `answers.date_of_birth` and a canonical DOB; `learn-daniel-gvili-new` is the bound page); Nicholas Dambruoso (explicit `date_of_birth` already canonical, calendar `answers.date` stays unbound); `learn-731462` (age-only `age` digit string, canonical age present, DOB correctly absent); Evan Marukos and Ron Dorah (newest event already sends `date_of_birth` and stores canonical DOB and age, so no `date` binding was added); Ben Stephens and the typo host `go.lifeinsuranceforvet.com/learn-robby-wells` (no events and no confirmed birthday key).

Unassociated LeadCapture rows were not given bindings from client association. Still seen after the release: `go.lifeinsuranceforvets.com/learn` (`cmuyab5iv0005kt0tua97mffr`, James Torrey legacy calendar), `my.leadcapture.io/p/6sxvbgvw` (`cmw9mg24m00qojo0u6un3m61a`, field meaning not confirmed), `learn-nick-agents` (`cmw0knqfk01ntkm0uorv5xrl7`, registry binding exists, association is not confirmed), and `learn-5428` (`cmw090p2c012skm0u1ku2cokp`, same). Older unassociated rows include the real Robby Wells page, `learn-179930`, `learn-madison-pimentel-634632`, `learn-ryan-wooldridge`, `my.leadcapture.io/p/6rci-usi`, `my.leadcapture.io/p/6khoj2_q`, three canary pages, and one row with a provider UUID and a null page (`cmtvxrjj200k2n20u44me7m1w`). Routing and delivery were not changed.

Local proof, not a production worksheet write: a stored payload shaped like the October 26 event projects an empty DOB cell and an empty `sheet.dobAge`. The same projection of a newly normalized learn-sam-test `DATE` answer fills `03/13/1955` and derived age `71` through `explainDraftProjection`, which is the function the draft preview uses. `DATE` reaches the existing `date` alias through `normalizeSourceFieldKey`. No uppercase alias was added.

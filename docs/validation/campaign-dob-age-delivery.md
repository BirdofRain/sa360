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
`UNKNOWN_ROUTE`. The reusable registry is `SCOPED_INCOMING_FIELD_BINDINGS`
in `source-field-alias.registry.ts`. Historical recovery uses that same file.
It does not keep a second allowlist or DOB parser.

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

The catalog pass adds every other live page whose public DOB step webhooks `date` or, for the two self-employed forms, `date_copy`, and whose catalog `SourceFunnel` id matches that page. A missing production DOB is not required. Louie Mezzone (`cmw19ikp1002ng70u84bqx9on`) and Michael Coulter (`cmw195f4x001vg70uch6dcxty`) did send `date` with no canonical DOB. Jordan Montero's public step webhooks `date`, while stored event `cmw18wo540013g70u61affdvx` used `date_of_birth` and already stored a canonical DOB. The `date` alias is configuration evidence; that event did not exercise it. `learn-andrew-hearn` and `my.leadcapture.io/p/6khoj2_q` embed the same funnel as the nurse Julia page (`5164ed76-dadf-40ac-b148-1863f52c0e1a`). Each page keeps its own source id. No receiving client is assigned. `learn-sam-test` has the same DOB step and is left unbound. The funnel is a named onboarding test, not a client campaign. A page-scoped `date` to `date_of_birth` binding on `go.lifeinsuranceforvets.com/learn-sam-test` would use the same normalizer as the campaign pages. That binding records `scopedFieldBindingId` and fills canonical DOB and age. It does not select a client, change a routing rule, or change a delivery flag. It is safe for onboarding tests that submit a birthday in `date`. A non-birthday `date` on that page would be stored as a DOB, so the test payload has to keep that meaning. This phase does not add the binding: no production intake gap was demonstrated, and the page stays out of the historical manifest.

The Eriks example source lead `e452eaed-92c8-4916-9dd1-fbd001dafaac` is a
provider lead id, not a `SourceLeadEvent` id. Its raw `date` is `01/27/1949`
and its `submitted_at` is `2026-11-03T09:53:33.092Z` (4:53 AM America/New_York).
The canonical DOB is `1949-01-27` and the age at that submission is 77. That
lead arrived before the Julia-only release and stays historically blank until
a separate correction runs. The GET-only reader reports `sourceLeadLookups`.
It matches raw `lead_id` on details it already fetched and does not request
that UUID as an event id. Until an authorized read finds exactly one event,
that lookup stays pending.

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
| `learn-sam-test` | public DOB step webhooks `date` on funnel `5b6959bf-5e41-4508-a802-500f0cc9279b`, source `cmvpb65gf004hi70u6hphb3zu` | same scoped normalization is safe for onboarding tests and would not change routing or delivery; left unbound, no production gap |
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
`/admin/v1/source-leads`. It refuses write flags and a non-HTTPS host. It
pages the newest-first list until the window start is crossed. The default
assessment is `historical`. That window stays
`2026-10-26T04:00:00.000Z` through `2026-11-03T15:36:00.000Z` (October 26,
2026 00:00 through November 3, 2026 10:36 America/New_York). The historical
assessment always requests the known event `cmvzggvc00091ou0t9a644muo` and
the six next-gen ids recorded before the `fcb1324` deploy. `--released-intake`
is a second assessment. It begins at `2026-11-03T17:42:00.000Z` (November 3,
2026 12:42 PM America/New_York), when deployment `f9cbbcf4` of `fcb1324`
became active. An omitted end on that assessment is the process clock and is
printed as `window.receivedTo` with `receivedToSource` `process_clock`. That
flag does not change the historical window and does not fetch the known event
or the six morning ids unless they fall inside the released-intake scan.
Each inspection separates `storedCanonical` (the saved DOB, age, provenance,
and reference date) from `proposedRecovery` (recomputed;
`proposedRecoveryIsProductionVerification` is false). `formIdentity` names
`confirmedBindingId`, the internal `sourceFunnelId`, and `providerFunnelId`.
`providerFunnelId` is the external LeadCapture funnel UUID, not
`SourceFunnel.id`. `missingInspectionIds` lists requested ids the API did not
return. Pagination reports `complete`, `stoppedReason`, `pages`, and
`listItemsSeen`. `sourceLeadLookups` matches confirmed provider lead ids
from raw `lead_id` on those fetched details. An incomplete page, a missing
match, or more than one match stays `pending` and does not invent an event
id. Sheets jobs and lead allocations stay unresolved.

`pnpm source-intake:dob-correction` plans that fill from the same normalizer.
The default is a dry run over that same fixed window and prints
`confirmedDateOfBirthBindingIds`. `--apply` does not turn that scan into a
write set. It requires the database host, an operator name, a limit, the
confirmation `APPLY CONFIRMED CAMPAIGN DOB CORRECTION`, and an explicit
reviewed scope: repeated `--id` values plus `--expected-count`, or a
manifest `{ "ids": [...], "expectedCount": N }`. The count must equal the
id list, the list cannot contain duplicates, and `--limit` cannot be smaller
than that count. Every named id must exist and plan as `apply`. Anything
else returns `reviewed_scope_required`, `reviewed_count_mismatch`,
`reviewed_scope_mismatch`, or `manifest_unreadable` and writes nothing.
A window scan cannot add ids.

It also requires `IncomingDobCorrectionAudit` to match the documented
schema, not merely to exist. That table is an Auth/Account migration and is
not created by this command. See
`docs/validation/incoming-dob-correction-audit-migration.md`. While the
relation is absent, apply and rollback return `audit_relation_required`. A
table with the right name and the wrong columns, key, index, or action
check returns `audit_relation_incompatible`. Either refusal writes nothing.
Auth/Account added `IncomingDobCorrectionAudit` on master in
`prisma/migrations/20261103184500_incoming_dob_correction_audit`. This
branch is refreshed onto the #275 merge `f04906e6aa4793f594071d44460998bf5b861c16`.
The correction command still defaults to a dry run. Nothing in this refresh
was applied, replayed, or written to a destination. The #275 deploy log
showed 99 migrations and none pending, so a later apply would not refuse for
a missing audit table. Do not run it without a separate authorization.
Confirmed birthday recovery now follows every registry binding whose alias
for `date` is `date_of_birth`. `date_copy` bindings are not in that set.

When the compatible table exists, the payload update and the audit insert commit
together. The audit stores before and after for every canonical field this
command changes, including `sourceAttributes.date_of_birth` when that
attribute is added. A local `.dob-correction-audit.jsonl` file is optional
and is not the source of rollback. If that export fails, the database row
still stands. The command fills only blank canonical DOB, age, provenance,
reference, and conflict fields, and copies `sourceAttributes.date_of_birth`
only when that object already exists and the canonical DOB was blank. A
nonblank disagreement is skipped. Under the row lock it rechecks the window
and the reviewed before-image, and skips `outside_window` or
`changed_under_lock` instead of writing. Raw payload, status, routing,
receipts, inventory, and external GHL or Sheets values are not changed.
`updatedAt` moves. `receivedAt`, `normalizedAt`, `createdAt`, and
`deliveredAt` do not. Rows are locked with `SELECT … FOR UPDATE SKIP LOCKED`
in batches of 25. A lock skip is `pending` and the outcome is `PENDING`
with exit code 3, so the row cannot disappear from
`written + skipped + pending`. A second apply writes nothing. `--rollback`
with `ROLLBACK CONFIRMED CAMPAIGN DOB CORRECTION` reads open audit rows from
`IncomingDobCorrectionAudit`, including after a process restart. It restores
every audited canonical field when the current values still equal the
audited after-image, and it inserts its own audit row in that same
transaction. A later edit is `rollback_mismatch` and is left in place.
Updating `normalizedPayloadJson` can refresh the historical catalog read
model. It does not enqueue delivery. Do not point `--apply` at production
until that write is separately authorized. None of the existing audit models
(`LeadVerificationApprovalAuditEvent`, `LeadProofReviewAuditEvent`,
`LeadCaptureTrustSyncAuditEvent`, `Lf2CheckpointAAuditEvent`,
`ClientOnboardingSetupAuditEvent`, `DeliveryRuntimeModeAuditEvent`,
`ClientOnboardingV2AuditEvent`) can store this before/after correction.

When a GHL destination map selects Age or DOB, the source-attribute stamp
uses `projectCampaignDobAge` on the lifecycle payload. Age sends the
canonical consumer age, including `lead_details.consumer_age`. DOB sends
`YYYY-MM-DD`. A supplied age that disagrees with the DOB is still the value
that is sent. The stamp does not enable delivery or change the destination.
The onboarding note still does not calculate age. Occupation, coverage type,
and beneficiary relationship stay unmapped; the original answers remain on
the raw payload.

## Historical dry run after the registry refresh

The GET-only admin reader ran against the fixed window
`2026-10-26T04:00:00.000Z` through `2026-11-03T15:36:00.000Z`
(October 26, 2026 00:00 through November 3, 2026 10:36 America/New_York).
The read finished at `2026-11-04T00:02:51.454Z` (November 3, 2026 7:02 PM
America/New_York). Pagination was complete: 17 pages, 3,400 list items,
3,259 details, stopped because `receivedAt` crossed the window start.
No correction was applied, no event was replayed, and no destination cell
was written.

| Class | Count | Reason |
| --- | --- | --- |
| eligible | 1,015 | `fill_blank_canonical` |
| unchanged | 1 | `already_canonical` (Julia Dodge) |
| conflicting | 0 | none |
| invalid | 0 | none |
| skipped | 2,243 | 1,318 `not_confirmed_form`, 925 `no_raw_date` |

Recoverable fields on the eligible rows: 1,015 blank `date_of_birth` values
and 1,011 blank `consumer_age` values. Four eligible rows already have an
age (one each on Dom Scalice, Logan Carlisle, Marcus Turo, and Reid Mazzuco).
The manifest does not overwrite that age. Routing status on rows whose
`date` is a birthday is `routing_matched` for 1,933 rows and
`routing_unmatched` for 8. Three unmatched rows are eligible: learn-5428 /
Tori Haskell (2) and learn-nick-agents (1). Five more unmatched rows are
Aleksandre Vayshelboym and have no raw `date`. Those associations stay
unresolved. No client is assigned from a public funnel name.

Twenty veteran `date` bindings hold the 1,015 eligible rows. Thirteen nurse
`date` bindings and 10 Alex Gross rows matched and had no raw `date`, so
they are skipped rather than corrected. `date_copy` pages are absent.
Ryan Wooldridge and Robby Wells September events are before the window
start, so the scan did not fetch them. Events after 10:36 AM America/New_York
on November 3, including post-release intake, are also outside this manifest.

`alreadyDelivered` is 0 and `heldDeliveredIds` is empty for `deliveredAt`,
status `delivered`, and a GHL `externalCallExecuted` write. Sheets jobs and
lead allocations are not on this API. An empty held list does not prove
those rows were never sent. The apply-shaped manifest is
`docs/validation/incoming-dob-correction-manifest.json`: `ids` length 1,015
and `expectedCount` 1,015. It was not passed to the correction command.
The known Julia event `cmvzggvc00091ou0t9a644muo` is eligible and included.
The Eriks provider-lead lookup now matches one in-window event,
`cmw0ifrg801k5km0u2rf8z3ke`, and that id is in the manifest.

## Post-release intake after #275

API deployment `5368246a-b7a6-40fa-a1c2-7be07b1a1967` of `f04906e6` was
active at `2026-11-03T23:29:50Z` (November 3, 2026 6:29 PM America/New_York).
One bounded read at `2026-11-03T23:47:09Z` (6:47 PM America/New_York) looked
at naturally arriving LeadCapture events after that instant. `deliveredAt`
was empty on each. That does not prove destination delivery.

| Event | Received (America/New_York) | Page | Incoming field | Canonical | Routing |
| --- | --- | --- | --- | --- | --- |
| `cmw1bpjhg0001ix0uyvmmzhgt` | 6:32 PM | `learn-logan-carlisle` | `date` | DOB and age | `routing_matched` |
| `cmw1bq0zw000fix0uym626dq0` | 6:33 PM | `learn-nick-agents` | `date` | DOB and age | `routing_unmatched` |
| `cmw1bujn3000qix0u8cjjyoqy` | 6:36 PM | `learn-marcus-turo` | `date` | DOB and age | `routing_matched` |
| `cmw1c14qh0014ix0u41wvijkm` | 6:41 PM | `learn-andrew-walters` | `date` | DOB and age | `routing_matched` |
| `cmw1c4m6t001iix0uc0cakopt` | 6:44 PM | `go.lifeinsuranceforvets.com/learn` | calendar `date` plus `age` | age only; DOB stays unset | legacy James route |

Those four `date` successes are future intake on bindings #275 already
released. The James calendar `date` is still not a birthday. No further
campaign-binding change follows from this read.

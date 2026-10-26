# Client onboarding v2 acceptance

Acceptance for the contract in `docs/architecture/client-onboarding-v2.md`.
These checks are for later implementation PRs. This document does not run them
against production, Google, or GoHighLevel.

A check passes only when the server enforces it. A hidden client field, a UI
default, or an admin-actor header is not enforcement.

The local fixture below is synthetic. It is not a client's live workbook and
it is not created in Google by these checks.

## Fixture

Workbook tabs:

| Title | Row 1 | Other rows |
| --- | --- | --- |
| `Campaign Leads` | the 35 `company_sheets_campaign_v3` headers, exact text and order | none |
| `VET Web Form` | 15 cells. Two of them are exactly `Age/ DOB` and `Primary Reason`. The other thirteen are test labels that are not v3 headers | five data rows |
| `Daily Stats` | any header, including a copy of the v3 header | any |
| `Weekly Stats` | any header | any |

Also include a header longer than 35 whose first 35 cells equal v3, and the
cells `Age/DOB`, `Age / DOB`, `Age`, and `DOB` on otherwise unknown headers.

Client id in tests is local, for example `onb_fixture_client`. Do not use a
production account id as the fixture identity.

## Readiness

1. With `SA360_CLIENT_ONBOARDING_V2_READ_ENABLED` unset, `GET /admin/v1/clients/:id/onboarding`
   returns 404 `onboarding_read_disabled` and performs no Google or GHL call.
2. With the flag `true`, the GET returns `contractVersion` `client_onboarding_v2`,
   `setupRequest.operational` false, `externalZapier.replacedByNative` false,
   and `liveActivationPerformedByOnboarding` false.
3. An unknown client returns 404 `client_not_found`. A body client id that
   differs from the path returns 400 `client_account_mismatch`.
4. Observer cookie, portal session, and missing admin key are denied. The
   observer allowlist diff is empty.
5. When a destination already has `campaignDispatchEnabled` true, the GET
   reports that value and the stored cutoff. It does not write the destination
   row.

## Source proof

Given one confirmed LeadCapture `SourceFunnel` and no events:

- `linked.satisfied` is true
- `observed`, `routing_matched`, and `delivery` are false

Given a capture-only Meta or Zapier Facebook event whose enrichment has
`captureOnly: true`:

- `observed.satisfied` is true and `captureOnly` is true
- `routing_matched` and `delivery` are false
- the payload's `nextAction` still says no delivery was attempted

Given a `routing_matched` event from a confirmed association, and a second
event matched only by a loose UTM rule:

- the association event can satisfy `routing_matched`
- the loose event is reported as `loose_rule_not_source_proof` and does not
  satisfy `routing_matched`

Given a succeeded Sheets canary or campaign-test job:

- `delivery.satisfied` is false

The source-proof GET does not insert a `SourceLeadEvent`, a routing decision,
or a dispatch intent.

## Drive and sheet preview

1. Search `scope` `approved_parent` with query `Alex` does not issue a Drive
   query containing the raw client string as Drive query syntax. A shortcut is
   not followed. `saved` is false.
2. Pasted spreadsheet and folder URLs still go through the existing resolve
   routes. Preview does not HTTP-fetch the pasted URL.
3. `Campaign Leads` classifies as `v3_exact_header`, `fastPath` true,
   `historicalDataRows` `empty`, `requiresExplicitSelection` true.
4. A longer prefix classifies as `v3_prefix_with_extra_columns`, `fastPath`
   false. Dispatch readiness for that header stays not ready under the current
   exact-length check. `sameHeader` is unchanged.
5. `VET Web Form` classifies as `legacy_custom_required`. `historicalDataRowCount`
   is 5. `deliveryEligible` is false. Row 1 and the five rows are not written.
6. `Daily Stats` and `Weekly Stats` classify as `stats_excluded` even when row
   1 is the v3 header. Selection returns `stats_tab_not_a_delivery_target`.
   There is no request field that overrides this.
7. A blank grid stays `compatible_empty` and is not a legacy map.
8. Preview does not call append, update, add-sheet, or permissions.

## Column map

1. `POST .../google-sheets/column-mapping` still returns `customMapping: false`
   for v3.
2. Creating a custom map for a `v3_exact_header` sheet returns
   `use_existing_v3_bind` and inserts nothing.
3. A draft is ignored by any writer. Publish fails with `mapping_unresolved`
   while `Age/ DOB`, `Age/DOB`, or `Age / DOB` is `ambiguous`.
4. Publishing an explicit target of `Age` does not fill `DOB`. Publishing
   `DOB` does not fill `Age` and does not parse the age column as a date.
   Publishing `unmapped` writes a blank cell.
5. Plain `Age` may map to `Age`. Plain `DOB` may map to `DOB`.
6. An assignment from `Primary Reason` to `Primary Concern` returns 422
   `primary_reason_is_not_primary_concern` with no override phrase.
7. `DEFAULT_SOURCE_FIELD_ALIASES` does not gain `Age/ DOB`, `Primary Reason`
   as an alias of `primary_concern`, or any fuzzy `reason` alias.
8. Header drift between snapshot and the live row 1 returns 409 `header_changed`
   and does not publish.
9. A second published row for the same client, scope, spreadsheet, and
   worksheet is rejected. Retire does not delete the row and does not call
   Google.
10. A published custom map does not set `CompanySheetsTabContract.schemaVersion`
    to `company_sheets_campaign_custom_v1` before the custom-writer flag exists.
11. v3 row bytes for an existing fixture event match the current campaign mapper,
    including a blank Primary Concern when only `primary_reason` is stored.

## GHL

1. PUT destinations with `notesEnabled: true` and mode `inbound_webhook` or
   `external_zapier` is rejected or stored as `notesEnabled: false`.
2. PUT does not change `ClientGhlDestination.deliveryEnabled`,
   `workflowTriggerMode`, or `campaignDispatchEnabled`.
3. The default trigger mode for a destination that omits it remains
   `tag_trigger`.
4. Webhook PUT stores `enabled`, `isPrimary`, and `isRequired` false,
   `campaignDispatchEnabled` false, and a null cutoff. LF2
   `listEnabledDeliveryTargetsForClient` does not return the row.
5. A second PUT while an enabled `webhook.generic.v1` row exists returns 409
   `webhook_target_already_armed` and leaves that row unchanged.
6. `buildOnboardingLeadNote` emits separate Age, DOB, Primary reason, and
   Primary concern lines. Primary concern is `not supplied` when only primary
   reason is stored. The title is `SA360 lead`. The body does not contain the
   raw payload or the label `Age/ DOB`.
7. The note function performs no HTTP call.
8. No onboarding test inserts `GhlLiveDeliveryRun` with mode
   `ghl_inbound_webhook`.

## Test runs and receipts

1. `preview` and `captured_event_replay` persist `externalCalls.providerWebhook`
   false and do not call `fetch`.
2. Replay of an event resolved to another client returns 403 `tenant_mismatch`.
3. Replay of an unresolved event returns 409 `event_not_client_owned`.
4. Replay of `company_sheets_internal_pilot` for any other client returns 409
   `internal_pilot_not_client_proof`.
5. Sheets synthetic execution, when invoked, is the existing campaign-test
   route. It does not create inventory, a billing row, or a dispatch intent,
   and it does not set `campaignDispatchEnabled`.
6. GHL synthetic execution returns `ghl_synthetic_disabled` while
   `SA360_CLIENT_ONBOARDING_GHL_SYNTHETIC_ENABLED` is unset.
7. A permission-probe receipt has `rowWritten` false and `doesNotProve`
   containing `row_appended` and `ghl`.
8. A succeeded Sheets receipt does not flip the GHL gate. A GHL preview does
   not flip the Sheets gate.

## Activation intent

1. The confirmation phrase `ACTIVATE CLIENT ONBOARDING DESTINATION` is required.
2. The intent row is `blocked` when any required gate is false, including a
   missing writer receipt or an uncertain job.
3. A `ready_for_operator` intent does not change
   `campaignDispatchNotBefore`, `campaignDispatchEnabled`, or
   `agedDispatchEnabled`.
4. The handler does not call `setCompanySheetsDispatchActivation`.
5. Global dispatch and execution flags are unread for the purpose of turning
   them on. Their values after the call equal their values before the call.

## Isolation and non-regression

1. Portal `GET /client/v1/integrations/google/company-sheets` still rejects a
   supplied `clientAccountId`.
2. No new route is mounted outside `/admin/v1`.
3. Buyer CSV still leaves Primary Concern empty when the stored field is
   `primary_reason` only. The consumer-age regression that encodes that rule
   is not edited.
4. Company Sheets v1 and v2 header fixtures still produce the same row text.
5. Dispatch off still inserts no `CompanySheetsDispatchIntent` and does not
   scan older events.
6. A pre-cutoff event still does not schedule. An existing cutoff is not
   replaced with `2026-10-22T00:50:17.124Z` or with a later time.
7. An uncertain Sheets append is not retried by a test-run or by publish.
8. Client deletion cascades maps and test runs. Audit rows keep
   `historicalClientAccountId`.

## Implementation PR gates

Each implementation PR, before it is ready for review, shows:

- the flags it reads, all still defaulting off
- the files it touched, matching the ownership table in the architecture doc
- tests that cover the numbered checks in its section
- a statement that Google, GHL, Meta, and production Postgres were not called

The custom-writer PR additionally shows a local append fixture that adds one
row under the 15-column header and leaves the five historical rows and row 1
unchanged. That fixture uses a fake Sheets client, not a live spreadsheet.

The UI PR exercises the workspace against a local or mocked admin API: preview
classification for all four tabs, a blocked publish of `Age/ DOB`, a rejected
Primary Reason → Primary Concern assignment, and an activation intent that
stays `blocked` while the Sheets switch remains off. Observer login receives
403 on the page and on the BFF.

# Captured test delivery — integration interface

This is the contract for the captured-lead test orchestrator in
`apps/api/src/services/client-onboarding-v2/captured-test-delivery.ts` and the
unmounted route skeleton in `apps/api/src/routes/admin-client-onboarding-v2-test.ts`.

It follows PR #228 at `577b4fa2ec6707e7ce4cf1e20e2ae82988399b12` except where
that PR's reconcile rule is weaker than the append-timeout rule. Those
exceptions fail closed and are listed below. This document does not change
PR #228's files.

No flag is turned on. The route is not registered in `apps/api/src/app.ts`.
Nothing here calls Google, GHL, Meta, LeadCapture, or Prisma.

## Implemented

- Request validation for `preview`, `captured_event_replay`,
  `captured_event_delivery`, and `synthetic_delivery`.
- Exact `SourceLeadEvent` id match. `clientAccountIdResolved` must equal the
  path client. A null client is `409 event_not_client_owned`. A different
  client is `403 tenant_mismatch`.
- `company_sheets_internal_pilot` is `409 internal_pilot_not_client_proof`
  unless the path client is `company_sheets_internal_test`.
- `verified_test_identity` matches the event email or phone to an injected
  identity row. A miss is `403 verified_test_identity_mismatch`. No address
  is hardcoded.
- `isolated_destination` for Sheets targets the Canary worksheet and only
  when `canaryApproved` is true. The campaign tab is not the target.
- `isolated_destination` plus GHL is `409 ghl_isolation_unavailable`. The
  client's production location is not treated as isolated. A distinct
  location id supplied on the snapshot is still not a send.
- Idempotency keys are `onboarding-test:{testRunId}:sheets`,
  `:ghl-contact`, `:ghl-workflow`, `:ghl-note:{part}`, and `:ghl-webhook`.
  Keys that start with `lead:`, `campaign:`, `ghl-webhook:`, or `ghl-note:`
  return `409 production_idempotency_guard` before any adapter call.
- The sheet plan keeps `sourceLeadEventId` as the stored event and uses the
  test key as `delivery_row_id`. Row cells come from
  `companySheetsCampaignRowValues`. The external marker is
  `sa360DeliveryClass: "onboarding_captured_test"` plus `sa360TestRunId`.
- Sheets and GHL are separate attempts. A known GHL failure stores a
  succeeded Sheets attempt. A timeout or thrown adapter call is `uncertain`
  and does not start the next GHL step.
- An `executing` overlap returns `409 repeat_blocked_in_flight`.
- A succeeded or failed overlap starts a new run only with
  `REPEAT CAPTURED TEST LEAD` and `repeatOfTestRunId` of that latest run.
  The new run gets a new id and new keys. It does not resume the old HTTP call.
- GHL delivery requires `acknowledgeDownstreamAutomation: true` or returns
  `422 downstream_automation_not_acknowledged`. An allowed plan includes
  `ghl_workflow_may_start_downstream_automation`. Workflow HTTP success sets
  `downstreamExecuted` false and proves only `http_accepted`.
- `synthetic_delivery` for Sheets names `sendCompanySheetsCampaignTestRow`
  (`POST /admin/v1/clients/:clientAccountId/google-sheets/campaign-test`).
  An unresolved campaign-test append returns `409 worksheet_blocked` and
  does not call the delegate. GHL synthetic returns `ghl_synthetic_disabled`.
- Preview and replay require `SA360_CLIENT_ONBOARDING_V2_CONFIG_ENABLED`
  exactly `true`. Executable kinds require
  `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED` exactly `true`, and
  while it is unset the route returns `404 captured_test_disabled` with
  zero adapter calls.
- Reconcile stores the operator observation, including an explicit "row was
  absent" note. It does not call Google or GHL.

## Fail closed against PR #228 acceptance item 17

PR #228 says that after reconcile of an `uncertain` run, a new run may name
it as `repeatOfTestRunId` and send again with new keys.

That is weaker than the existing company Sheets rule and weaker than the
timeout rule for this task:

- `appendStartedAt` means a request may still commit. A missing row does not
  clear it. `releaseCompanySheetsDeliveryHold` already returns
  `append_outcome_unresolved` when the marker is set and the row is missing
  or the read is truncated.
- An unknown GHL POST (timeout, thrown client, HTTP 5xx, 2xx without an id)
  is the same class of outcome. A later note part is not posted.

This module therefore keeps `repeat_blocked_uncertain` after reconcile.
`resendAuthorized`, `appendStartedAtCleared`, and `locksCleared` stay false.
The response includes `PR228_RECONCILE_DISCREPANCY`. Item 17 needs a
correction on PR #228 before any repeat of an uncertain captured test is
allowed. A correction has to prove the first request cannot commit. Seeing
an empty row is not that proof. This module also does not call
`releaseCompanySheetsDeliveryHold`, because that function can clear
`appendStartedAt` and the worksheet lock.

Isolated GHL is the other closed gap. The task refuses isolated GHL without
a real isolated location. PR #228 says there is no second location and always
refuses. There is no schema field for an isolated location. Supplying the
production location, or a distinct id on the in-memory snapshot, still
returns `ghl_isolation_unavailable` and performs no call. A future allow
path needs a PR #228 correction plus the shared migration. It must not copy
`ClientGhlDestination.destinationSubaccountIdGhl`.

## Blocked

| Block | What this PR does instead |
| --- | --- |
| Prisma tables `ClientOnboardingTestRun`, `ClientOnboardingTestAttempt`, `ClientOnboardingVerifiedTestIdentity`, `ClientOnboardingV2AuditEvent` | Injected store. The route default is `unavailableCapturedTestStore` (`persistence: "unavailable_pending_migration"`). PUT test identities returns `409 execution_pending_review` and writes nothing. |
| `app.ts` registration | Plugin is exported and tested with `Fastify.register` in the route test. It is not mounted. |
| Session role `ADMIN` vs `SA360_OBSERVER` | Admin API key only. Do not add these paths to an observer allowlist. |
| Agent B `buildOnboardingLeadNote` | Port `BuildOnboardingLeadNote`. Default `pendingOnboardingLeadNote`. Tests use `fakeOnboardingLeadNote`, which does not list form answers. A delivery note without `SA360 test run: {testRunId}` is refused before GHL calls. |
| Live Sheets append / lock | Port `CapturedTestSheetsAppendPort.append`. Production binding is `executeCompanySheetsDeliveryJob` (append, worksheet lock, RAW insert, uncertain outcome). The port has no clear-marker or release-lock method. |
| Live GHL location API | Port methods `upsertContact`, `createNote`, `enrollWorkflow`. Production paths are `POST /contacts/upsert`, `POST /contacts/{id}/notes`, and `POST /contacts/{id}/workflow/{workflowId}` with `direct_api`. Do not edit `ghl-live-transport.ts` or call `deliverGhlInboundWebhookFromIntake`. |
| Webhook destination | Planned key `onboarding-test:{testRunId}:ghl-webhook` and envelope fields `sa360DeliveryClass`, `sa360TestRunId` only. `externalCallExecuted` stays false. |
| External execution | Route default `execution: "disabled_pending_review"`. With the captured-test flag set, a valid plan returns `409 execution_pending_review` and does not call adapters. Unit tests pass `execution: "injected_fakes"` together with the fakes. |

`execution_pending_review`, `note_builder_pending_agent_b`, and
`repeat_of_required` are implementation gates. They are not new product
codes for PR #228 to adopt unless that PR wants names for these refusals.

## Production bindings to reuse, not reimplement

- Sheet cells: `companySheetsCampaignRowValues` and
  `campaignLeadIdentityFromPayload`.
- Synthetic row: `sendCompanySheetsCampaignTestRow`.
- Pilot client id: `COMPANY_SHEETS_INTERNAL_TEST_CLIENT`.
- Pilot classification: `isCompanySheetsInternalPilotLead`.
- Uncertain Sheets job: a job on the target worksheet with status `uncertain`,
  or `appendStartedAt` set and status not `succeeded`, is
  `409 worksheet_blocked`.
- Admin auth: `verifyAdminApiKey` (`x-sa360-admin-key`). `x-sa360-admin-actor`
  is stored as `actorLabel` and is not an authorization decision.

## Out of scope

Creating a `SourceLeadEvent`. Re-posting LeadCapture or Meta. Intake dedupe,
inventory allocation, billing, and `recordCompanySheetsCampaignIntent`.
Production keys `lead:`, `campaign:`, `ghl-webhook:`, and `ghl-note:`.
Editing the Google writer, the worksheet lock, PR #227 files, or Agent B's
formatter. Live network calls, merges, and deploys.

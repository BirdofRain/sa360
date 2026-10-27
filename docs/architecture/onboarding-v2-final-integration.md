# Client onboarding v2 final integration

This branch integrates the reviewed onboarding backend, the Admin C.O.C. workspace, the exact-v3 Google Sheets captured-test writer, and the fail-closed GHL location adapter. It does not merge any of those pull requests into `master`, and it does not enable activation or a production GHL host.

## Provenance

| Source | Head | Role |
| --- | --- | --- |
| `origin/master` | `28f1a657a8ff64e93336d4ea0aca5fe477d5189a` | Ancestor of PR #236. No commits on master after that head needed reconciliation. |
| PR #228 corrected contract | `7762d275d92e7f70c79d145954ba17a759cd7d6d` | Ancestor of PR #236. |
| PR #236 Agent E | `8aea5b8c8c1bff31bd8b2333ab181b1a82d85fbc` | Integration base. Branch `cursor/client-onboarding-v2-integrate-96e2`. |
| PR #239 Agent G | `18f7086b84940646a34fe9c187902d440c713b18` | Exact-v3 Sheets writer. Merged as `ed2a81eb`. |
| PR #238 Agent H | `d41cc99d9cb4b39e971cdd87e237610d8d5fa81b` | GHL captured-test adapter. Merged as `a9d3f014`. |
| PR #237 Agent F, first head | `90a6c81da3b68065724ec2573f87a2a0602805a3` | Setup and Delivery workspace. Merged as `15cc16ca`. |
| PR #237 Agent F, latest head | `6f69b45356c0845ad4b9a4bd00e5f90d53236990` | Explicit profile revision and refusal to save or bind while delivery is on. Merged as `75e561e1`. |
| PR #227 | not included | Inbound webhook code was not modified. |

Pairwise diffs of #237, #238, and #239 against #236 did not overlap. Both merges of #237 were clean `ort` merges. No conflict markers were left.

`master` is an ancestor of #236 (`236..master` is empty). Production behavior on master was not removed.

## GHL execution owner

Option B. `createOnboardingGhlTestAdapter().deliver()` is the only POST owner. `onboarding-ghl-aggregate-execution.ts` builds one request and projects the receipt into the existing attempt and key rows. The orchestrator does not call `upsertContact`, `createNote`, and `enrollWorkflow` on that path.

Option A was not selected. Splitting `deliver()` into step methods would duplicate the adapter's tested stop-on-uncertain sequence or leave two owners that can each POST.

The three-step port remains for unit fakes. `app.ts` does not mount it. When the aggregate port is set, the step port is not called.

## Mock-only GHL transport

The adapter still refuses non-loopback origins, including `services.leadconnectorhq.com`. Flags set to `true` do not create a production-host allowlist. The mounted adapter uses the default production base URL, which the adapter refuses before `fetch`. Tests use `https://127.0.0.1` and an injected token. `downstream_executed` stays false. HTTP 2xx is not treated as downstream execution.

## Sheets writer

`createOnboardingCapturedTestSheetsAppend` wraps the existing company writer. Jobs use `kind = onboarding_captured_test` and `idempotencyKey = onboarding-test:{testRunId}:sheets`. Appends stay RAW and INSERT_ROWS. The 35-cell row is refused for the four-column Canary worksheet, stats tabs, another client's sheet, a stale revision, a changed header, and an unresolved lock. `rereadOnboardingCapturedTestSheet` reads the approved `ClientOnboardingTestWorksheet`. Global Sheets execution and dispatch flags are not changed.

## Operator contracts

| Gap | Status |
| --- | --- |
| A. Destination profile revision | `GET .../onboarding` returns `destinationProfile.revision`. The workspace sends that value. It does not substitute `setupRequest.revision`. A missing revision leaves save disabled. |
| B. Resolve then browse | Resolve still does not save. `POST .../onboarding/drive/spreadsheets` lists children of a resolved folder with `saved: false` and `linked: false`. The live workspace shows that browse only after resolve. |
| C. Save and bind | Server actions call the existing Sheets destination and campaign-tab APIs. They refuse when campaign or aged dispatch is on or unknown. Preview and recommendation do not save or bind. |
| D. Test-run list | `GET .../onboarding/test-runs` lists persisted runs. The onboarding page loads that list. |
| E. Sheet row preview | Captured-test preview includes the 35-cell header and values. The console shows them when present. Secrets are not added to the payload. |
| F. Flags and client switch | Summary `runtime` reports the real flag booleans, `ghlProductionHostAllowed: false`, `activationEnabled: false`, and client status. The workspace prints the existing campaign, aged, and global switches and does not change them. |
| G. Exact-v3 approval and write probe | The header reader and write probe stay the reviewed endpoints. Approve and probe buttons run only after an operator views a worksheet. Approval requires an exact-v3 classification. The probe writes no row. |

Activation remains `404 activation_disabled`.

## Local evidence

The mocked Alex Gross walkthrough uses synthetic ids, `alex.gross.mock@example.invalid`, and `+15555550123`. Google is an in-memory sheet. GHL is `https://127.0.0.1`. The run appended one 35-cell RAW row to Campaign Leads, left Historical Leads and Daily Stats empty, posted contact, note, and workflow once each, kept `downstreamExecuted` false, left source, inventory, billing, dispatch intents, and delivery switches unchanged, rejected a duplicate request without another POST, blocked an uncertain GHL resend, and received `activation_disabled` from the activate route.

No new Prisma migration was added. The existing `20261026233000_client_onboarding_v2_persistence` migration was applied only to the local `sa360_test` database so the walkthrough could run.

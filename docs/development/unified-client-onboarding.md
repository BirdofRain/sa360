# Unified client onboarding

This note records the audit of the native Admin C.O.C. onboarding flow and the
sequence for bringing it onto the records SA360 already stores. A setup request
remains administrative metadata. It does not authorize intake, routing,
allocation, delivery, or live activation.

## What already exists

| Concern | Authoritative record | Operator surface | Write? |
| --- | --- | --- | --- |
| Client registry | `ClientAccount` | Clients & Subaccounts detail | Existing client tools |
| Setup request | `ClientOnboardingSetup` via `client-onboarding-setup.service.ts` | `ClientSetupPanel` when `SA360_NATIVE_CLIENT_SETUP_ENABLED` | Draft and review only |
| LeadCapture sources | `SourceFunnel` via `source-funnel.service.ts` and `source-funnel-admin.present.ts` | `LeadCaptureSourcesSection` inside Advanced configuration | Associate, confirm, reassign, clear |
| Source proof | `readClientSourceProof` in `client-onboarding-v2/source-proof.ts` | Setup & Delivery summary | Read |
| Onboarding summary and gates | `readClientOnboardingSummary` | Setup & Delivery | Read. Hidden when the v2 read flag is off |
| Company Google identity and Client Folders root | Company Google connection | Company Google Sheets page | OAuth and folder writes live there |
| Client folder, spreadsheets, destination, sharing note, dispatch | Company Sheets services | `CompanySheetsAdminPanel` | Create, share, publish, and dispatch live there |
| GoHighLevel destination | Client delivery config on the client detail | GHL destination configuration | Existing delivery config |
| Routing campaign ids | Routing rules on the client detail | Existing routing tools | Not part of onboarding |
| Staff directory | `StaffPrincipal` via `listStaffTeam` | Staff team routes that require a live staff session | Invitation and access changes |
| Guided request copy | `onboarding-guide.ts` | Team Workspace guided onboarding | Request saves, not operational writes |

Do not add a second association service, destination store, or staff directory.
The client detail summary reads these records. Advanced configuration and the
dedicated Sheets, GHL, and Setup & Delivery pages keep their current writes.

## First change

The client detail page now shows a read-only summary before the setup request:

- Every source returned for the client, with observed name, public URL, provider,
  first and last lead, association status, and campaign ids only when a source
  proof names a routing rule that already has them.
- Identified, observed, associated, and verified are separate. Verification
  requires a stored source event id. A confirmed association, a setup checkbox,
  and "Mark setup reviewed" do not verify anything.
- Missing provider funnel ids, campaign ids, and the provider lead UUID stay
  unknown. The current source-proof payload does not include the provider lead UUID.
- Traffic platform is filled only from an observed source kind of
  `meta_lead_ads` or `zapier_facebook` (Facebook), or a literal `google` /
  `google_ads` / `other` kind. The LeadCapture provider is not a traffic platform.
- Requested destination and the stored Sheets or GoHighLevel destination are
  shown separately. Sheets shows the connected Google account, the Client
  Folders root, the associated client folder, spreadsheets in that folder,
  access status, write readiness, destination revision, and superseded links.
- Sharing email is labeled "Share spreadsheet with (email)" and is not applied.
- The nine setup lines are derived from stored records. A failed read stays
  unknown instead of looking empty.
- Advanced configuration stays on the page and says that it can write.

This page does not associate a source, save a destination, share a file,
publish a map, send a test, or change a delivery flag.

## Later changes

1. **Source association in the summary.** Paste a campaign or funnel URL through
   the existing source association route. Keep the explicit reassignment
   confirmation. Select a received submission as evidence. That step needs
   `readClientSourceProof` to return the provider lead id (`sourceLeadId`) and
   any campaign id already stored on the event. Do not invent those values in
   the browser.
2. **Sheets selection.** Reuse the Company Sheets folder, spreadsheet, and
   worksheet reads. Disambiguate when more than one client folder matches.
   Saving a destination, sharing, publishing a map, and enabling dispatch stay
   explicit actions on the existing services.
3. **Setup owner.** Replace the free-text label with the staff directory.
   Default it only when the Admin C.O.C. session is a verified staff principal.
   A shared admin key has no principal. Do not match staff by email. Persist
   the principal id beside the legacy owner string. No migration is authorized
   for that step until the Auth/Account lane agrees the setup document can
   store the id.
4. **Retire the duplicate questionnaire** only after the association and
   destination actions above are reviewed. Until then the request form remains
   available and Advanced configuration remains reachable.

## Blockers

- Provider lead UUID and observed campaign id are not on the source-funnel list
  or the onboarding source proof. The summary says unknown.
- Folder disambiguation uses the stored client-folder association. Name search
  that can return several folders is a separate existing action and is not run
  from this read-only summary.
- Staff listing requires a staff session. The setup request still stores a
  free-text owner and says that text is not an authorization.
- Onboarding proof gates are unavailable when client-onboarding v2 read is off.
  Source, destination, and delivery lines that depend on them stay unknown.

## Acceptance for this change

- Opening a client shows stored sources and destinations without retyping them.
- Multiple sources all appear. Suggested sources are not described as associated
  or verified.
- A Sheets destination, an absent client folder, a permission failure, a
  superseded spreadsheet, and an unavailable read each have their own state.
- Setup review and the webhook or test checkboxes do not flip verification,
  field mapping, test delivery, or live delivery.
- Live delivery is shown from stored flags only. Ray Rodriguez, and every other
  client, is not updated by opening the page.
- No feature flag, webhook, intake path, routing rule, or delivery writer changes.

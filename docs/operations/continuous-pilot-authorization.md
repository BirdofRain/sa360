# Continuous pilot destination authorization

Ongoing delivery uses the normal intake path and a destination the operator has activated on that client. It does not use a global single-plan pin, an `operatorDummy` marker, or a per-lead approval.

## Obsolete for onboarding

These variables are no longer the way an operator authorizes a client:

| Variable | Previous behavior | Migration |
| --- | --- | --- |
| `SA360_LIVE_CANARY_ALLOWED_DESTINATIONS` | An unset value used to be treated as allowing the caller through. A set value listed `clientId:locationId` pairs. | An unset value authorizes nobody. A destination with persisted live flags (`deliveryEnabled`, `deliveryMode=live`, `clientCutoverApproved`, `internalApprovalStatus=approved`) and a matching saved location skips this list. Unactivated destinations stay blocked when the list is unset or they are absent from it. Do not add pilot clients to this list. |
| `SA360_DIRECT_DELIVERY_ALLOWED_CLIENT_IDS` | Empty falls back to the demo client only. | Still used by approve-delivery and bulk paths. Ongoing association delivery does not read it. Empty does not mean every client. |
| `SA360_DIRECT_DELIVERY_ALLOWED_LOCATION_IDS` | Empty falls back to the demo location only. Both lists must be non-empty before `isDirectLiveDeliveryEnvConfigured` is true. | Same as the client list. Ongoing delivery does not read it. |

`SA360_LF2_GHL_ALLOWED_*` and `SA360_LEADCAPTURE_TRUST_SYNC_CAMPAIGN_ALLOWLIST` stay product gates. This pilot does not open them.

## Remaining global controls

- `SA360_GHL_ONGOING_DELIVERY_ENABLED`. Exact `true` on the API process is the durable service switch for association GHL writes and for a selected GHL test. It does not authorize a client. An unset or any other value leaves those writes dependent on the short live-canary window. Set it on `sa360-api` only. Leave it on after the first successful delivery.
- GHL adapter mode. The admin control `ENABLE LIVE CANARY` still opens a window of at most 30 minutes and then returns the process to simulate. That window is the manual canary control. Ongoing association delivery does not require it when `SA360_GHL_ONGOING_DELIVERY_ENABLED` is `true`.
- `SA360_COMPANY_GOOGLE_SHEETS_ENABLED`, `SA360_COMPANY_GOOGLE_SHEETS_DISPATCH_ENABLED`, and `SA360_COMPANY_GOOGLE_SHEETS_EXECUTION_ENABLED`. The worker posts one drain request to the API. The API process is the process that appends rows, so execution is read there. The worker only needs dispatch enabled.
- `SA360_CLIENT_ONBOARDING_V2_CUSTOM_WRITER_ENABLED` for the published custom campaign writer.
- `SA360_CLIENT_ONBOARDING_V2_CAPTURED_TEST_ENABLED` gates the pre-activation Sheets test button only. Set it on the API service when that button is needed. Ongoing Sheets dispatch does not read it.
- Admin authentication and the admin role check on COC actions and `/admin/v1` routes.

## Operator path

An authenticated admin connects the destination, validates it, and activates that client from COC:

1. Create the client and confirm the parent URL.
2. Select the copied spreadsheet and existing tab, preview the column map, publish it, send one selected Sheets test, then enable campaign delivery.
3. Connect or select the GHL location, discover and save the workflow, review omitted fields, send one selected GHL test, then enable ongoing GHL delivery.

Activation writes `ClientGhlDestination` flags and a `ClientOnboardingV2AuditEvent` with action `activate_ghl_ongoing`. It does not edit DigitalOcean environment variables. Sheets and GHL stay independent: a failure in one does not create a second write in the other.

A blank Primary Concern cell is filled from `primary_reason` and the preview labels that source. A blank pair stays blank and is labeled omitted. Mapping a header named Primary Reason onto `primary_concern` stays invalid.

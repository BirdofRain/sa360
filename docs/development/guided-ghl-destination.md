# Guided GoHighLevel destination configuration

Team Workspace can review a client's saved GoHighLevel destination. It does not
change that destination, and it does not authorize delivery.

The production flags `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED`,
`SA360_TEAM_WORKSPACE_ENABLED`, and `SA360_NATIVE_CLIENT_SETUP_ENABLED` stay
default-off. This document does not turn them on.

## Existing services reused

- `GET /admin/v1/clients/:clientAccountId/delivery-config` reads
  `ClientGhlDestination`, the linked location, and readiness issue codes. It
  does not call GoHighLevel when the stored snapshot is enough for that summary.
- `GET /admin/v1/ghl/connections?clientAccountId=` lists linked locations.
- `GET /admin/v1/ghl/locations/:locationId/config` reads the stored location
  snapshot. `refresh=true` refreshes that snapshot from GoHighLevel. It does
  not enroll a contact.
- `POST /admin/v1/ghl/connections/:id/probe` checks one linked location's
  credentials and updates the connection probe status. It does not write
  `ClientGhlDestination`.
- Saved survey mappings stay in `sourceAttributeFieldMapJson`. Saved SA360 ids
  stay in `sa360CustomFieldIdMapJson`. Desired coverage, branch of service, and
  primary reason remain three separate keys.
- `isPersistedLiveDestination` is the live predicate: saved location,
  `deliveryEnabled`, `deliveryMode === "live"`, `clientCutoverApproved`, and
  `internalApprovalStatus === "approved"`.

## Which writes are operational

`POST /admin/v1/clients/:clientAccountId/ghl-config` preserves the four
activation flags, but it is not a safe setup write:

- It merges discovered field ids over the saved map. Discovery matches field
  keys and display names. A name match would be stored as a field id.
- `applyLalAiBot1WebformConfiguration` can retarget the workflow and turn
  opportunity creation off.
- The write does not refuse a destination that is already live, so a location
  or workflow change can change what a live destination does.
- `confirmLocationMismatch` can retarget the location.

`PATCH /admin/v1/ghl/connections/:id/link-client` links a location and upserts
the destination location while preserving activation flags. On a live row that
moves the authorized location. It is not used here.

`POST /admin/v1/clients/:clientAccountId/ghl-destination/activate-ongoing` and
`POST /admin/v1/clients/:clientAccountId/ghl-destination/test-delivery` authorize
or execute delivery. They are not used here.

`POST /admin/v1/routing/rules/:id/ghl-config` changes a routing rule. It is not
used here. Company Sheets writers are not used here.

The onboarding v2 workflow route is unwired unless its dependencies are
injected, and its flag stays default-off. It is not a proven write path.

## What Team Workspace does

The destination step still saves only the setup draft's destination choice.
The guide then:

1. Lists linked locations. Choosing one does not save it.
2. Reads workflow ids from the location snapshot. A Webform name is not
   selected automatically. LAL AI Bot-1 handling is left unchanged.
3. Compares saved field ids with snapshot field ids. A matching display name,
   or a saved field key, is an outstanding issue, not verification.
4. Shows configured, verified, and active separately.
5. Refuses the destination save. The save action returns `WRITE_BLOCKED` and
   does not call the API.
6. Checks credentials only for a linked connection on a destination that is
   not live. A live destination is not probed.

An uncertain read is not described as saved. A later read with a different
`updatedAt` is shown as a stale saved destination. The guide does not send a
lead, create a delivery run, or enroll a workflow.

## Missing safe boundary

There is no existing client destination write that can save a location,
workflow id, or field id without also merging discovered names and without
the ability to edit a live row. That boundary belongs in the API, in front of
`saveClientGhlConfig` and `linkGhlConnectionToClient`, and it was not added
here. Until it exists, Team Workspace cannot save GoHighLevel destination
configuration.

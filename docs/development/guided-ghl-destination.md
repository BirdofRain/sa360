# Guided GoHighLevel destination configuration

Team Workspace can review a client's saved GoHighLevel destination. It does not
change that destination, and it does not authorize delivery.

The production flags `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED`,
`SA360_TEAM_WORKSPACE_ENABLED`, `SA360_NATIVE_CLIENT_SETUP_ENABLED`, and
`SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED` stay default-off. This document
does not turn them on.

## Existing services reused

- `GET /admin/v1/clients/:clientAccountId/delivery-config` reads
  `ClientGhlDestination`, the linked location, and readiness issue codes. It
  does not call GoHighLevel when the stored snapshot is enough for that summary.
- `GET /admin/v1/ghl/connections?clientAccountId=` lists linked locations.
- `GET /admin/v1/ghl/locations/:locationId/config` reads the stored location
  snapshot. `refresh=true` refreshes that snapshot from GoHighLevel. A failed
  refresh is stored for audit and does not replace the last complete snapshot.
  Loading the location returns that earlier snapshot marked previously
  captured. It is not current verification. The read does not enroll a contact.
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

## What the existing writers still do

There is no existing client destination write that can save a location,
workflow id, or field id without also merging discovered names and without
the ability to edit a live row. `linkGhlConnectionToClient` is unchanged. `saveClientGhlConfig` and
`POST /admin/v1/routing/rules/:id/ghl-config` still merge discovered field ids
when the newest snapshot for that location is a complete discovery no older
than 24 hours and no more than five minutes ahead of the API clock. A failed,
partial, stale, or missing snapshot rejects the save before any destination or
routing write. An older complete snapshot is not used as authorization. Stored
mappings, workflow ids, owner assignment, and delivery flags stay as they were.
A failed refresh does not turn delivery off.

A non-live `ClientGhlDestination` is still operational. Selected one-lead
delivery reads its workflow id and field maps without
`isPersistedLiveDestination`. Association plan generation copies those columns
into the plan. Ongoing association delivery does re-check the four live flags.
That check does not make a shadow-column update safe, because the selected
test path does not use it.

## Configuration requests

`GET` and `POST /admin/v1/clients/:clientAccountId/ghl-destination-configuration`
store an intended location id, workflow id, and explicit field ids in
`GhlDestinationConfigurationRequest`. The table is not read by delivery,
enrollment, or routing. The route does not insert or update
`ClientGhlDestination`.

`SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED` must be the exact string `true`.
Unset, blank, and `TRUE` stay off. The route requires the admin API key and
rejects a portal key, portal assertion, or workspace key first. It is not on
the observer allowlist.

The location must be a connected `GhlLocationConnection` for that client. The
workflow id must equal a workflow `id` in the newest snapshot for that
location, and that snapshot must be a complete successful discovery. A failed,
partial, authentication, outage, timeout, or malformed refresh is stored for
audit and is not current verification. A location response counts only when
its id is the requested location, wrapped or unwrapped. Each list counts only
when it is that resource's collection or a data, items, or results envelope.
An empty list for that resource is a successful discovery. Another resource's
collection is not. An older usable snapshot is not
substituted for this check. A workflow name, including a name containing
Webform, is not selected. Each field id must equal a custom-field `id` in that
same complete snapshot. A field key, display name, or discovered id is not substituted. The same field
id on two keys is rejected. Desired coverage, branch of service, and primary
reason stay distinct keys. A snapshot older than 24 hours is expired. A snapshot more than five minutes
ahead of the API clock is rejected. Five minutes is the only permitted clock
skew. An unparseable timestamp is rejected. A missing snapshot is rejected.

The save locks the client and the destination row. After that lock it reads
the destination again. A live destination aborts the transaction, including a
destination that became live after the caller loaded it. The caller's
`expectedDestinationUpdatedAt` must match the locked row, or be null when no
destination exists. The same `requestId` and payload returns the stored
result. A different payload with that id is rejected and does not consume a
new revision. Validation failures are not stored.

Team Workspace calls this route only after an admin session check, and only
when the Team Workspace flags, native client setup, and
`SA360_GHL_DESTINATION_CONFIG_REQUEST_ENABLED` are on. The configuration
request flag accepts only the exact string `true`. The screen keeps three
separate facts: the saved operational destination, the stored configuration
request, and the operator's unsaved choices.

The operator searches connected locations for that client and can select one
without saving. The snapshot for that selection is a preview. It is not
verification of the saved operational destination, and a snapshot from another
location is not shown as this location's workflows or field ids. A workflow is
submitted only by its id. A Webform name does not select one. Each mapping is
an explicit custom-field id. A display name or field key is left unresolved.

Saving posts one `requestId`, the request-chain `expectedRevision`, and
`expectedDestinationUpdatedAt` from the last authoritative read. Replacing a
stored request asks for confirmation first. An uncertain response keeps its
original id and payload. Reloading the current stored request does not treat a
different id, or no current request, as proof the unconfirmed request was
never stored. Retrying that original post uses the backend replay: the same
payload confirms the original id was stored, even when a later request is now
current. A confirmed save reloads the GET result. The
screen does not call the operational destination save, location linking,
activation, test delivery, workflow enrollment, routing changes, SourceFunnel
confirmation, or Company Sheets writers.

The new flag stays off, and this store does not enable delivery.

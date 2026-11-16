# External webhook setup in Team Workspace

Operators configure an external webhook from the existing Team Workspace
onboarding destination step. The step order stays Client, Information,
Sources, Destination, Summary. This screen does not create a second
onboarding flow, and it does not turn delivery on by itself.

The configuration bridge stays off unless
`SA360_EXTERNAL_WEBHOOK_CONFIG_BRIDGE_ENABLED` is exactly `true`. While it is
off, the guide says configuration is turned off and does not offer a save or
an activation. Saving a destination does not change the separate global
webhook delivery switch. An enabled row is not proof that leads are flowing.

## What an operator does

1. Choose GoHighLevel inbound webhook, or Make / custom HTTPS. These are
   alternative primary CRM methods. Company Sheets can stay on beside either
   one. Choosing a webhook does not replace a saved native GoHighLevel
   destination.
2. Paste the webhook URL. A signing secret is offered only for custom HTTPS
   with HMAC. The URL and secret are not shown again after they are saved.
3. Check the endpoint. The check reports hostname, authentication, credential
   readiness, a primary CRM conflict, and whether the revision still matches.
   It does not send a lead.
4. Save the disabled configuration. The screen then says lead delivery is off.
5. An administrator reviews the hostname, type, revision, and any native
   GoHighLevel conflict, then confirms before enabling or turning off the row.

## Who can do what

The server decides. The screen only hides actions the session is not allowed
to start.

- An Admin C.O.C. administrator can read, check, save a disabled destination,
  and enable or turn off the row.
- A Team Workspace session with team manager can read, check, and save a
  disabled destination.
- Team Workspace on its own, and Team Workspace with team operations, can read.
- Observer, portal, anonymous, and limited staff sessions stay on the existing
  Team Workspace guards.

A revision conflict stops the save until the operator reloads the saved
configuration. A request id that was already used for a different
configuration is not replaced automatically. If another primary CRM is already
active, native GoHighLevel and Company Sheets are left as they are.

## Delivery and notifications

The latest attempt, when one exists, is described in plain language. A
successful HTTP response does not prove a contact was created. An uncertain
attempt is not a reason to resend. A failed attempt means SA360 did not
confirm delivery.

Email and SMS notification delivery is managed separately and is not enabled
by saving this webhook.

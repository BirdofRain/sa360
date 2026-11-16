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
4. Save the disabled configuration. The screen then says the external webhook
   destination was saved and disabled. That does not turn off native
   GoHighLevel or Company Sheets, and it does not read the global delivery
   switch.
5. An administrator reviews the hostname, type, revision, and any native
   GoHighLevel conflict, then confirms before enabling or turning off the row.
   Enabling the row is not the same as the global delivery switch being on.
   This screen does not know that switch's live value.

The onboarding intention choices stay `ghl`, `google_sheets`, `both`,
`intake_only`, and `undecided`. `ghl` means native GoHighLevel. It is not an
external GoHighLevel inbound webhook. Persisting an external-webhook intention
would need a setup-schema change. This screen does not add that value. The
webhook configuration is stored only through the external webhook actions.

A failed read, including a timeout, leaves check, save, and activation
unavailable. The screen does not assume revision 0 when the read did not
succeed. Save stays off until the latest check matches the current URL,
authentication, secret, and saved revision, with a valid endpoint, valid
authentication, credentials ready, a matching revision, and no primary CRM
conflict. Editing any of those, or starting over after a request-id conflict,
requires a new check.

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

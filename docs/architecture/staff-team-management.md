# Staff team management

A Google-authenticated administrator with a live `admin_coc` grant approves an exact `@lifeagentlaunch.com` mailbox and an access level. The employee signs in with Google. The first successful sign-in binds that verified Google subject to the approved principal.

This does not replace the issuer-secret enrollment path. It does not accept the shared admin API key or the shared-password Admin C.O.C. session as a provisioning authority.

## Permissions

Authorization is the current `StaffPermission` rows. The invitation `accessLevel` is a label.

| Access | Granted permissions | Not granted |
| --- | --- | --- |
| Administrator | `admin_coc` | `team_workspace`, `team_manager`, `team_operations` are not added. Existing full Admin C.O.C. access stays `admin_coc`. |
| Manager | `team_workspace`, `team_manager` | `admin_coc`, `facebook_association_correction` |
| Operations | `team_workspace`, `team_operations` | `admin_coc`, `team_manager`, `facebook_association_correction` |

Granting Administrator requires `confirmAdministrator: true`. The actor's staff principal id is stored on the management event. New invitations default to the caller's selected non-admin level; the form defaults to Manager.

No team permission implies `admin_coc`.

## Invitation

`StaffInvitation` stores the approved mailbox, access label, status (`pending`, `consumed`, `canceled`), expiry, and inviting principal. There is no bearer secret and no invitation code. A pending invitation lasts 7 days. Expiry is a pending row whose `expiresAt` is in the past. One pending invitation is allowed per principal.

The sign-in URL is `/staff/google/start` on `https://sa360-api-staging-coo57.ondigitalocean.app`, or on localhost for a local test. The API rejects every other hostname, plus query strings and fragments. The Admin server builds that URL from the configured Google redirect origin only when the origin is one of those two. A client-supplied hostname is not used. When `RESEND_API_KEY` and `SA360_TRANSACTIONAL_EMAIL_FROM` are set, the API sends that URL. Otherwise the invitation stays pending and the admin copies the link. The response says the email was not sent.

An administrator cannot demote, revoke, or disable their own account. A change that would leave no active, bound `admin_coc` principal is rejected. Those checks lock the effective grant rows inside the same transaction. Other staff can still be changed.

## First login

`POST /internal/staff/google/resolve` still refuses an unbound principal. The login callback calls resolve first. Only when resolve denies the account does it call `POST /internal/staff/google/claim`.

Claim requires a verified Google ID token (signature, issuer, audience, nonce, expiration, `email_verified`) plus:

- hosted-domain claim `hd` exactly `lifeagentlaunch.com` (fixed in code; an environment variable cannot widen it)
- the verified email exactly equal to a pending, unexpired invitation
- an active principal whose `providerSubject` is still null

The bind updates `providerSubject` only where it is null, consumes the invitation, and writes `invitation_consumed`. A second claim, a different subject, a canceled invitation, a disabled principal, or an expired invitation does not replace the binding. Concurrent claims take one row lock; one bind wins.

The claim response is `{ ok: false }` for every denial. It does not reveal whether the mailbox was approved.

## Management API

`/internal/staff/team/*` requires the staff Google service header, a signed staff session, an active Redis registration, an active bound principal, and `staffAdminCocAllows`. The issuer secret, admin API key, and shared-password cookie are not read.

`POST /internal/staff/session/capabilities` returns `admin`, `workspace`, or `limited` from the current grants. Admin C.O.C. middleware uses that decision. `admin_coc` lands on `/`. `team_workspace` lands on `/team-workspace`. Anything else lands on `/staff`.

## Team Workspace

Manager and Operations do not receive `admin_coc`.

Reads of the existing client, setup, onboarding summary, source-funnel, and configuration-request GETs require `team_workspace`. The admin API key is attached only after that allowlist matches.

Manager writes are limited to client create, client profile patch, setup draft patch, and the three configuration-request POSTs that store a request and do not execute delivery. Each action still checks its existing feature flag.

Operations can open Team Workspace and read those views. Operations cannot call the manager writes.

These stay on the existing admin-only guards:

- live GoHighLevel destination save and location preview
- delivery activation and test delivery
- Company Sheets delivery execution
- order creation and fulfillment execution
- inventory mutation
- `facebook_association_correction`
- command-center diagnostics and platform credentials

Direct calls that miss the allowlist receive 403 and the admin key is not attached.

## Audit

`StaffManagementEvent` is append-only. It records invitations, email sent or skipped, claim success and rejection, sign-in, access changes, revocation, and disable. Events do not store tokens, secrets, or URL queries. Google `sub` is stored on claim and sign-in events and is not returned by the roster API.

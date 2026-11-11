# Staff team management rollout

Do not run this sequence from a cloud agent against production. Do not create production staff, send production invitations, or change Sam's `admin_coc` grant as part of deploying the code.

## What the migration does

`prisma/migrations/20261111220000_staff_team_management` adds:

- permission values `team_workspace`, `team_manager`, and `team_operations`
- empty `StaffInvitation` and `StaffManagementEvent` tables
- guards that keep invitation identity immutable, keep consumed invitations terminal, reject deletes, and keep management events append-only

It does not insert principals, permissions, or invitations. It does not contain a production email. It does not drop `StaffPermission_one_effective_grant_key`.

Apply it with the existing local-then-deploy migration path. A second `prisma migrate deploy` against the same local database must be a no-op. The migration is additive. PostgreSQL cannot drop a used enum value in a down migration. Leave the tables in place if the application is rolled back. Roll the API back only before any `team_*` grant exists, or revoke those grants first. An older Prisma client can fail when it reads a permission value it does not know.

## Production activation

1. Confirm the deployed API already has Google staff sign-in, the staff session secret, the staff Google service secret, and the `admin_coc` grant for the working administrator. Do not rotate those secrets for this feature.
2. Deploy the API so the migration runs on the application database through the existing pipeline. Deploy Admin C.O.C. with the same release.
3. Leave OAuth client id, client secret, redirect URIs, and the canonical callback origin unchanged.
4. Leave `NEXT_PUBLIC_SA360_TEAM_WORKSPACE_ENABLED` and `SA360_TEAM_WORKSPACE_ENABLED` as they already are. Team Workspace pages stay disabled unless those flags are exact `true`.
5. Leave delivery, Sheets, GoHighLevel activation, and Meta correction flags unchanged.
6. Sign in as the existing Google administrator and open `/team-management`. A shared-password session can see the navigation link and then the page explains that it cannot manage staff.
7. Add one synthetic or approved company mailbox only when the operator is ready. Choose Manager or Operations. Administrator requires the confirmation checkbox.
8. If email is configured (`RESEND_API_KEY` and `SA360_TRANSACTIONAL_EMAIL_FROM`), the roster shows that the message was sent. If email is not configured, the roster stays Pending and the operator uses Copy sign-in link. The link is exactly `https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/start`. It has no code. An administrator cannot remove their own access, and the last active administrator cannot be removed.
9. The employee opens that page, chooses the approved Workspace account, and lands on `/team-workspace` for Manager or Operations, or `/` for an administrator.

## Rollback

Stop inviting. Disable or revoke any access created by the new page. Redeploy the previous Admin C.O.C. and API only when no `team_workspace`, `team_manager`, or `team_operations` grant remains. Do not delete `StaffManagementEvent` rows. Do not clear `providerSubject`.

## Known limits

Order creation, fulfillment execution, inventory mutation, live destination activation, test delivery, and historical Meta correction are not available to Manager or Operations. Those routes stay behind the existing admin session and their feature flags. Opening them would require a later change that keeps each safety gate, rather than granting `admin_coc`.

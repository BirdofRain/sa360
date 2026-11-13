import assert from "node:assert/strict";
import test from "node:test";

import {
  accessLevelFromPermissions,
  hostedDomainMatches,
  normalizeCompanyEmail,
  parseStaffSignInUrl,
  permissionsForAccessLevel,
  staffAccountStatus,
} from "./staff-team-policy.js";

test("company mailbox matching rejects lookalikes and external mailboxes", () => {
  assert.equal(normalizeCompanyEmail("  Matt.Smith@LifeAgentLaunch.com "), "matt.smith@lifeagentlaunch.com");
  assert.equal(normalizeCompanyEmail("matt.smith@lifeagentlaunch.com"), "matt.smith@lifeagentlaunch.com");
  assert.equal(normalizeCompanyEmail("matt+admin@lifeagentlaunch.com"), null);
  assert.equal(normalizeCompanyEmail("matt@lifeagentlaunch.com.evil.com"), null);
  assert.equal(normalizeCompanyEmail("matt@evil.lifeagentlaunch.com"), null);
  assert.equal(normalizeCompanyEmail("matt@gmail.com"), null);
  assert.equal(normalizeCompanyEmail("matt@lifeagent1aunch.com"), null);
  assert.equal(normalizeCompanyEmail("matt@lifeagentlaunch.com "), "matt@lifeagentlaunch.com");
  assert.equal(normalizeCompanyEmail("matt @lifeagentlaunch.com"), null);
  assert.equal(normalizeCompanyEmail("mаtt@lifeagentlaunch.com"), null);
  assert.equal(hostedDomainMatches("lifeagentlaunch.com"), true);
  assert.equal(hostedDomainMatches("gmail.com"), false);
  assert.equal(hostedDomainMatches("lifeagentlaunch.com.evil.com"), false);
});

test("ordinary access levels never include admin_coc", () => {
  assert.deepEqual(permissionsForAccessLevel("manager"), ["team_workspace", "team_manager"]);
  assert.deepEqual(permissionsForAccessLevel("operations"), ["team_workspace", "team_operations"]);
  assert.deepEqual(permissionsForAccessLevel("administrator"), ["admin_coc"]);
  assert.equal(permissionsForAccessLevel("manager").includes("admin_coc"), false);
  assert.equal(permissionsForAccessLevel("operations").includes("admin_coc"), false);
  assert.equal(accessLevelFromPermissions(["team_workspace", "team_manager"]), "manager");
  assert.equal(accessLevelFromPermissions(["team_operations", "team_workspace"]), "operations");
  assert.equal(accessLevelFromPermissions(["admin_coc", "team_manager"]), "administrator");
  assert.equal(accessLevelFromPermissions(["facebook_association_correction"]), "none");
});

test("sign-in links stay on the branded origin or localhost", () => {
  const approved = "https://portal.lifeagentlaunch.com/staff/google/start";
  assert.equal(parseStaffSignInUrl(approved), approved);
  assert.equal(parseStaffSignInUrl("https://sa360-api-staging-coo57.ondigitalocean.app/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl("http://127.0.0.1:3456/staff/google/start"), "http://127.0.0.1:3456/staff/google/start");
  assert.equal(parseStaffSignInUrl("http://localhost:3000/staff/google/start"), "http://localhost:3000/staff/google/start");
  assert.equal(parseStaffSignInUrl("https://evil.example/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl("https://admin.example/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl("https://portal.lifeagentlaunch.com.evil.com/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl(`${approved}?code=secret`), null);
  assert.equal(parseStaffSignInUrl("https://portal.lifeagentlaunch.com/staff/google/enroll/start"), null);
  assert.equal(parseStaffSignInUrl("http://evil.example/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl("http://portal.lifeagentlaunch.com/staff/google/start"), null);
  assert.equal(parseStaffSignInUrl(`https://user:pass@portal.lifeagentlaunch.com/staff/google/start`), null);
});

test("account status follows the principal, the grant, and the invitation", () => {
  const now = new Date("2026-11-11T18:00:00.000Z");
  const future = new Date("2026-11-18T18:00:00.000Z");
  const past = new Date("2026-11-10T18:00:00.000Z");
  assert.equal(
    staffAccountStatus({
      principalStatus: "active",
      bound: false,
      granted: ["team_workspace", "team_manager"],
      invitationStatus: "pending",
      invitationExpiresAt: future,
      now,
    }),
    "pending"
  );
  assert.equal(
    staffAccountStatus({
      principalStatus: "active",
      bound: false,
      granted: ["team_workspace"],
      invitationStatus: "pending",
      invitationExpiresAt: past,
      now,
    }),
    "invitation_expired"
  );
  assert.equal(
    staffAccountStatus({
      principalStatus: "active",
      bound: true,
      granted: ["team_workspace", "team_operations"],
      invitationStatus: "consumed",
      invitationExpiresAt: future,
      now,
    }),
    "active"
  );
  assert.equal(
    staffAccountStatus({
      principalStatus: "active",
      bound: true,
      granted: [],
      invitationStatus: "consumed",
      invitationExpiresAt: future,
      now,
    }),
    "revoked"
  );
  assert.equal(
    staffAccountStatus({
      principalStatus: "disabled",
      bound: true,
      granted: ["admin_coc"],
      invitationStatus: "consumed",
      invitationExpiresAt: future,
      now,
    }),
    "disabled"
  );
});

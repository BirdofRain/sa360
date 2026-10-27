import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { appendFileSync, chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, before, describe, it } from "node:test";

import { specFingerprint } from "../app-spec-shape.mjs";
import {
  ADMIN_APP_ID,
  PINNED_SA360_FINGERPRINT,
  PRODUCTION_APP_ID,
  executeCutover,
  previewCutover,
  recoverCutover,
} from "./controller.mjs";
import { buildLoginUrl, changePasswordWithLibpq, escapePgpass, generatePassword, operatorConnectionPolicy, operatorVerifyFull, productionAdminUrlAccepted, validateOperatorCa } from "./password-install.mjs";
import { classifyMigrationLog, collectMigrationLog, completeComponentLine, componentScript, consoleCommands, evaluatePostActive, healthTargets, migrateEvidenceFromLog, migrationLogLocations, openConsole, parseComponentReport, parseSummaryRow, passingPostActiveEvidence, readLogBody, readPublicHealth } from "./post-active.mjs";
import { productionProbeChecks, runProbe } from "./probe.mjs";
import { redact } from "./redact.mjs";
import { auditProposedSpec, planDatabaseUrlOverrides } from "./spec-plan.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../..");
const runbookPath = path.join(repoRoot, "docs/operations/historical-catalog-summary-boundary-b-v1.md");
const APP = "11111111-1111-4111-8111-111111111111";
const ADMIN_URL = "postgresql://doadmin:fixture-admin-password@db.example:25060/defaultdb?sslmode=require";
const PASSWORD = "b2-installed-password-value-not-real";
const CIPHERTEXT = "EV[1:fixture-ciphertext]";
const PG_BIN = "/usr/lib/postgresql/18/bin";

function assertHidden(condition, message) {
  if (!condition) throw new Error(message);
}

function fixtureSpec(adminUrl = ADMIN_URL) {
  return {
    name: "sa360",
    region: "nyc",
    features: ["buildpack-stack=ubuntu-22"],
    domains: [{ domain: "api.example.com", type: "PRIMARY" }],
    alerts: [{ rule: "DEPLOYMENT_FAILED" }],
    ingress: { rules: [{ match: { path: { prefix: "/" } }, component: { name: "sa360-api" } }] },
    databases: [],
    envs: [
      { key: "DATABASE_URL", scope: "RUN_AND_BUILD_TIME", value: adminUrl },
      { key: "REDIS_URL", scope: "RUN_AND_BUILD_TIME", value: "rediss://default:fixture-redis-password@redis.example:25061" },
      { key: "SOME_TOKEN", scope: "RUN_TIME", type: "SECRET", value: CIPHERTEXT },
      { key: "PLAIN", scope: "RUN_TIME", value: "keep-me" },
    ],
    services: [
      {
        name: "sa360-api",
        run_command: "pnpm --filter @sa360/api start",
        instance_size_slug: "apps-s-1vcpu-1gb",
        github: { repo: "BirdofRain/sa360", branch: "master", deploy_on_push: true },
        envs: [{ key: "SA360_BUILD_COMMIT_SHA", scope: "RUN_TIME", value: "abc" }],
      },
    ],
    workers: [
      {
        name: "sa360-worker",
        run_command: "pnpm --filter @sa360/worker start",
        instance_size_slug: "apps-s-1vcpu-1gb",
        github: { repo: "BirdofRain/sa360", branch: "master", deploy_on_push: null },
        envs: [],
      },
    ],
    jobs: [
      {
        name: "sa360-migrate",
        kind: "PRE_DEPLOY",
        run_command: "pnpm migrate:deploy",
        github: { repo: "BirdofRain/sa360", branch: "master", deploy_on_push: true },
        instance_size_slug: "basic-xxs",
      },
    ],
  };
}

function response(status, payload) {
  return { status, async text() { return JSON.stringify(payload); } };
}

function createPlatform(mode, appId = APP) {
  const original = fixtureSpec();
  const state = {
    spec: structuredClone(original),
    original,
    active: { id: "dep-before", phase: "ACTIVE", result: "SUCCEEDED" },
    inProgress: mode === "in_progress" ? { id: "dep-busy", phase: "DEPLOYING" } : null,
    deployments: { "dep-before": { id: "dep-before", phase: "ACTIVE", result: "SUCCEEDED" } },
    calls: [],
    validates: 0,
    failGets: false,
  };
  async function fetchImpl(url, options = {}) {
    if (state.failGets && (options.method ?? "GET") === "GET") throw new Error("socket hang up fixture-canary-do-not-print");
    const method = options.method ?? "GET";
    const requestPath = new URL(url).pathname;
    const body = options.body ? JSON.parse(options.body) : null;
    state.calls.push({ method, path: requestPath, body });
    if (method === "GET" && requestPath === `/v2/apps/${appId}`) {
      return response(200, {
        app: {
          id: appId,
          spec: state.spec,
          active_deployment: state.active,
          in_progress_deployment: state.inProgress,
        },
      });
    }
    if (method === "GET" && requestPath.startsWith(`/v2/apps/${appId}/deployments/`)) {
      const id = requestPath.split("/").pop();
      const deployment = state.deployments[id] ?? { id, phase: "DEPLOYING" };
      if ((mode === "ok" || mode === "lose_put_applied") && id === "dep-new") {
        deployment.phase = "ACTIVE";
        deployment.result = "SUCCEEDED";
        state.active = deployment;
        state.inProgress = null;
      }
      state.deployments[id] = deployment;
      return response(200, { deployment });
    }
    if (method === "POST" && requestPath === `/v2/apps/${appId}/rollback/validate`) {
      state.validates += 1;
      if (mode === "validate_403") return response(403, {});
      if (mode === "validate_invalid") return response(200, { valid: false });
      if (mode === "recover_validate_invalid" && state.validates > 1) return response(200, { valid: false });
      return response(200, { valid: true, warnings: [] });
    }
    if (method === "POST" && requestPath === `/v2/apps/${appId}/rollback`) {
      if (mode === "rollback_lost" || mode === "rollback_and_fallback_lost") {
        throw new Error("socket hang up fixture-canary-do-not-print");
      }
      state.spec = structuredClone(state.original);
      const deployment = { id: "dep-rollback", phase: "ACTIVE", result: "SUCCEEDED" };
      state.deployments[deployment.id] = deployment;
      state.active = deployment;
      state.inProgress = null;
      return response(200, { deployment });
    }
    if (method === "PUT" && requestPath === `/v2/apps/${appId}`) {
      const puts = state.calls.filter((call) => call.method === "PUT").length;
      if (mode === "put_403") return response(403, {});
      if (mode === "lose_get_after_put") {
        state.failGets = true;
        throw new Error("socket hang up fixture-canary-do-not-print");
      }
      if (mode === "lose_put_not_applied") throw new Error("socket hang up fixture-canary-do-not-print");
      if (mode === "lose_put_corrupt") {
        state.spec = structuredClone(state.original);
        state.spec.region = "ams3";
        throw new Error("socket hang up fixture-canary-do-not-print");
      }
      if (mode === "lose_put_applied") {
        state.spec = body.spec;
        state.inProgress = { id: "dep-new", phase: "DEPLOYING" };
        state.deployments["dep-new"] = { id: "dep-new", phase: "DEPLOYING" };
        throw new Error("socket hang up fixture-canary-do-not-print");
      }
      if (mode === "rollback_and_fallback_lost" && puts >= 2) {
        throw new Error("socket hang up fixture-canary-do-not-print");
      }
      const failed = ["deploy_fails", "recover_validate_invalid", "rollback_lost", "rollback_and_fallback_lost", "deploy_ambiguous"].includes(mode) && puts === 1;
      state.spec = body.spec;
      const id = "dep-new";
      const deployment = failed
        ? { id, phase: mode === "deploy_ambiguous" ? "DEPLOYING" : "ERROR", result: mode === "deploy_ambiguous" ? "" : "FAILED" }
        : { id: puts === 1 ? "dep-new" : "dep-fallback", phase: "PENDING_BUILD", result: "" };
      state.deployments[deployment.id] = deployment;
      state.inProgress = mode === "deploy_ambiguous" ? deployment : null;
      if (!failed && deployment.phase === "PENDING_BUILD") {
        deployment.phase = "ACTIVE";
        deployment.result = "SUCCEEDED";
        state.active = deployment;
      }
      if (failed) state.active = state.deployments["dep-before"];
      return response(200, { deployment });
    }
    return response(404, {});
  }
  return { state, fetchImpl, original };
}

async function runMode(mode, extra = {}) {
  const platform = createPlatform(mode, extra.appId ?? APP);
  const dir = mkdtempSync(path.join(tmpdir(), "sa360-b2-state-"));
  let installs = 0;
  const report = await executeCutover({
    env: { SA360_BOUNDARY_B_OPERATOR: "operator", ...(extra.env ?? {}) },
    stateDir: dir,
    repoRoot,
    appId: extra.appId ?? APP,
    apiBase: "http://fake.invalid",
    token: "test-token",
    maxPolls: extra.maxPolls ?? 3,
    pollIntervalMs: 0,
    fetchImpl: extra.wrapFetch ? extra.wrapFetch(platform.fetchImpl) : (extra.fetchImpl ?? platform.fetchImpl),
    installPassword: extra.installPassword ?? (async ({ adminUrl }) => {
      installs += 1;
      return { ok: true, password: PASSWORD, url: buildLoginUrl(adminUrl, "sa360_app", PASSWORD) };
    }),
    probe: extra.probe ?? (async () => ({ ok: true, results: [] })),
    collectPostActive: extra.collectPostActive ?? (async () => passingPostActiveEvidence()),
  });
  return { report, platform, dir, installs };
}

function assertReportClean(report, dir) {
  const texts = [JSON.stringify(report), readFileSync(path.join(dir, "report.json"), "utf8")];
  for (const text of texts) {
    assertHidden(!text.includes("fixture-admin-password"), "report contains admin credential");
    assertHidden(!text.includes("fixture-redis-password"), "report contains redis credential");
    assertHidden(!text.includes(CIPHERTEXT), "report contains ciphertext");
    assertHidden(!text.includes(PASSWORD), "report contains new credential");
    assertHidden(!text.includes("b2-preview-placeholder"), "report contains preview credential");
    assertHidden(!text.includes("db.example"), "report contains database host");
    assertHidden(!text.includes("fixture-canary-do-not-print"), "report contains transport error");
    assertHidden(!text.includes("test-token"), "report contains token");
  }
}

describe("boundary B spec comparison", () => {
  const rules = { adminUser: "doadmin" };
  const databaseUrl = buildLoginUrl(ADMIN_URL, "sa360_app", PASSWORD);

  it("redacts verifiers, ciphertext, and URLs", () => {
    const verifier = `md5${"ab".repeat(16)}`;
    assert.equal(redact(`prefix ${verifier} postgresql://doadmin:secret@db.example/defaultdb ${CIPHERTEXT}`), "prefix [redacted] [redacted] [redacted]");
    assert.equal(redact("keep-me"), "keep-me");
  });

  it("allows only the two component database secrets", () => {
    const planned = planDatabaseUrlOverrides(fixtureSpec(), databaseUrl, rules);
    assert.equal(planned.ok, true, planned.problems.join(","));
    assert.deepEqual(planned.changes, [
      { component: "sa360-api", key: "DATABASE_URL", type: "SECRET", scope: "RUN_TIME" },
      { component: "sa360-worker", key: "DATABASE_URL", type: "SECRET", scope: "RUN_TIME" },
    ]);
    assert.equal(planned.next.jobs[0].envs, undefined);
    assert.equal(planned.next.envs[0].value, ADMIN_URL);
    assert.equal(planned.next.services[0].envs.at(-1).scope, "RUN_TIME");
    assert.equal(planned.next.workers[0].envs.at(-1).type, "SECRET");
  });

  it("rejects changes the shape fingerprint cannot see", () => {
    const previous = fixtureSpec();
    const cases = [
      ["plain", (spec) => { spec.envs.find((env) => env.key === "PLAIN").value = "tampered"; }],
      ["ciphertext", (spec) => { spec.envs.find((env) => env.key === "SOME_TOKEN").value = "EV[1:other-ciphertext]"; }],
      ["redis", (spec) => { spec.envs.find((env) => env.key === "REDIS_URL").value = spec.envs[1].value.replace("fixture-redis-password", "other-redis-password"); }],
      ["host", (spec) => { spec.envs[0].value = spec.envs[0].value.replace("db.example", "other.example"); }],
    ];
    for (const [name, mutate] of cases) {
      const tampered = structuredClone(previous);
      mutate(tampered);
      assert.equal(specFingerprint(previous), specFingerprint(tampered), name);
      assert.equal(auditProposedSpec(previous, tampered, databaseUrl, rules).ok, false, name);
    }
    const planned = planDatabaseUrlOverrides(previous, databaseUrl, rules);
    const swapped = structuredClone(planned.next);
    const other = buildLoginUrl(ADMIN_URL, "sa360_app", "b2-other-password-value-not-real");
    swapped.services[0].envs.at(-1).value = other;
    swapped.workers[0].envs.at(-1).value = other;
    assert.equal(specFingerprint(planned.next), specFingerprint(swapped));
    assert.equal(auditProposedSpec(previous, swapped, databaseUrl, rules).ok, false);
  });

  it("rejects unrelated spec fields and a migrate override", () => {
    const planned = planDatabaseUrlOverrides(fixtureSpec(), databaseUrl, rules);
    const region = structuredClone(planned.next);
    region.region = "ams3";
    assert.equal(auditProposedSpec(fixtureSpec(), region, databaseUrl, rules).ok, false);
    const migrate = structuredClone(planned.next);
    migrate.jobs[0].envs = [{ key: "DATABASE_URL", scope: "RUN_TIME", type: "SECRET", value: databaseUrl }];
    const migrateAudit = auditProposedSpec(fixtureSpec(), migrate, databaseUrl, rules);
    assert.equal(migrateAudit.ok, false);
    assert.equal(migrateAudit.problems.includes("migrate_override"), true);
    const production = planDatabaseUrlOverrides(fixtureSpec(ADMIN_URL.replace("25060", "5432")), databaseUrl.replace("25060", "5432"), { adminUser: "doadmin", production: true });
    assert.equal(production.ok, false);
    assert.equal(production.problems.includes("production_port"), true);
  });
});

describe("boundary B controller", () => {
  const dirs = [];
  after(() => {
    for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
  });

  async function run(mode, extra) {
    const result = await runMode(mode, extra);
    dirs.push(result.dir);
    return result;
  }

  it("deploys only the two secrets and keeps the saved spec free of the new credential", async () => {
    const result = await run("ok");
    assert.equal(result.report.ok, true);
    assert.equal(result.report.code, "deployed");
    assert.equal(result.report.recovery, null);
    assert.equal(result.installs, 1);
    const puts = result.platform.state.calls.filter((call) => call.method === "PUT");
    const rollbacks = result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate"));
    assert.equal(puts.length, 1);
    assert.equal(rollbacks.length, 0);
    assert.equal(puts[0].body.update_all_source_versions, false);
    assert.equal(puts[0].body.spec.services[0].envs.at(-1).key, "DATABASE_URL");
    assert.equal(puts[0].body.spec.workers[0].envs.at(-1).scope, "RUN_TIME");
    assert.equal("envs" in puts[0].body.spec.jobs[0], false);
    assertHidden(puts[0].body.spec.envs[0].value === ADMIN_URL, "app database url changed");
    assertHidden(JSON.stringify(puts[0].body).includes(CIPHERTEXT), "ciphertext was not preserved");
    assertHidden(puts[0].body.spec.services[0].envs.at(-1).value.includes(PASSWORD), "api secret missing");
    const saved = readFileSync(path.join(result.dir, "spec.json"), "utf8");
    assertHidden(saved.includes(CIPHERTEXT), "saved spec dropped ciphertext");
    assertHidden(!saved.includes(PASSWORD), "saved spec contains new credential");
    assert.equal(statSync(result.dir).mode & 0o777, 0o700);
    assert.equal(statSync(path.join(result.dir, "spec.json")).mode & 0o777, 0o600);
    assertReportClean(result.report, result.dir);
    const again = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: result.dir,
      repoRoot,
      appId: APP,
      apiBase: "http://fake.invalid",
      token: "test-token",
      fetchImpl: result.platform.fetchImpl,
      installPassword: async () => { throw new Error("second install"); },
      probe: async () => ({ ok: true }),
    });
    assert.equal(again.code, "state_exists");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
  });

  it("rolls a failed deployment back without a component container", async () => {
    const result = await run("deploy_fails");
    assert.equal(result.report.code, "recovered");
    assert.equal(result.report.recovery, "rollback");
    const rollback = result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate"));
    assert.equal(rollback.length, 1);
    assert.deepEqual(rollback[0].body, { deployment_id: "dep-before", skip_pin: true });
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
    const second = await recoverCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: result.dir,
      repoRoot,
      appId: APP,
      apiBase: "http://fake.invalid",
      token: "test-token",
      maxPolls: 2,
      pollIntervalMs: 0,
      fetchImpl: result.platform.fetchImpl,
    });
    assert.equal(second.code, "already_previous");
    assert.equal(result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate")).length, 1);
  });

  it("uses the saved spec when rollback validate is invalid", async () => {
    const result = await run("recover_validate_invalid");
    assert.equal(result.report.code, "recovered");
    assert.equal(result.report.recovery, "saved_spec");
    const rollback = result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate"));
    assert.equal(rollback.length, 0);
    const puts = result.platform.state.calls.filter((call) => call.method === "PUT");
    assert.equal(puts.length, 2);
    assert.equal(puts[1].body.update_all_source_versions, false);
    assertHidden(JSON.stringify(puts[1].body) === JSON.stringify({ spec: result.platform.original, update_all_source_versions: false }), "fallback spec changed");
    assertHidden(!JSON.stringify(puts[1].body).includes(PASSWORD), "fallback contains new credential");
  });

  it("stops a lost update when the spec did not change", async () => {
    const result = await run("lose_put_not_applied");
    assert.equal(result.report.code, "spec_unchanged");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
    assert.equal(result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate")).length, 0);
    assertReportClean(result.report, result.dir);
  });

  it("watches a deployment whose update response was lost after it was stored", async () => {
    const result = await run("lose_put_applied");
    assert.equal(result.report.code, "deployed");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
  });

  it("stops when a lost update leaves an unrecognized spec", async () => {
    const result = await run("lose_put_corrupt");
    assert.equal(result.report.code, "spec_unrecognized");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
    const recovered = await recoverCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: result.dir,
      repoRoot,
      appId: APP,
      apiBase: "http://fake.invalid",
      token: "test-token",
      maxPolls: 2,
      pollIntervalMs: 0,
      fetchImpl: result.platform.fetchImpl,
    });
    assert.equal(recovered.code, "recovered");
    assert.equal(recovered.recovery, "rollback");
  });

  it("does not send a second update when reconciliation cannot read the app", async () => {
    const result = await run("lose_get_after_put");
    assert.equal(result.report.code, "reconcile_unavailable");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
  });

  it("stops on an ambiguous deployment and can recover from the state directory alone", async () => {
    const result = await run("deploy_ambiguous", { maxPolls: 2 });
    assert.equal(result.report.code, "deployment_ambiguous");
    assert.equal(result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate")).length, 0);
    const recovered = await recoverCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: result.dir,
      repoRoot,
      appId: APP,
      apiBase: "http://fake.invalid",
      token: "test-token",
      maxPolls: 2,
      pollIntervalMs: 0,
      fetchImpl: result.platform.fetchImpl,
    });
    assert.equal(recovered.code, "recovered");
    assert.equal(recovered.recovery, "rollback");
    assertReportClean(recovered, result.dir);
  });

  it("stops after one lost rollback and one lost fallback", async () => {
    const result = await run("rollback_and_fallback_lost");
    assert.equal(result.report.code, "fallback_ambiguous");
    assert.equal(result.report.rollback_attempts, 1);
    assert.equal(result.report.fallback_attempts, 1);
    const puts = result.platform.state.calls.filter((call) => call.method === "PUT").length;
    const recovered = await recoverCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: result.dir,
      repoRoot,
      appId: APP,
      apiBase: "http://fake.invalid",
      token: "test-token",
      fetchImpl: () => { throw new Error("third mutation"); },
    });
    assert.equal(recovered.code, "recovery_exhausted");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, puts);
  });

  it("does not install a password when update authorization or the rollback target fails", async () => {
    for (const [mode, code] of [["validate_403", "update_not_authorized"], ["validate_invalid", "rollback_target_invalid"], ["in_progress", "deployment_in_progress"]]) {
      const result = await run(mode);
      assert.equal(result.report.code, code, mode);
      assert.equal(result.installs, 0, mode);
      assert.equal(existsSync(path.join(result.dir, "spec.json")), false, mode);
      assert.equal(result.platform.state.calls.some((call) => call.method === "PUT"), false, mode);
    }
  });

  it("treats a rejected update as no change", async () => {
    const result = await run("put_403");
    assert.equal(result.report.code, "put_rejected");
    assert.equal(result.platform.state.calls.filter((call) => call.method === "PUT").length, 1);
    assert.equal(result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate")).length, 0);
  });

  it("refuses production, the admin app, a component environment, and a state directory in the repo", async () => {
    const throwing = async () => { throw new Error("fetch_called"); };
    const productionDir = mkdtempSync(path.join(tmpdir(), "sa360-b2-prod-"));
    dirs.push(productionDir);
    const production = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: productionDir,
      repoRoot,
      appId: PRODUCTION_APP_ID,
      token: "test-token",
      fetchImpl: throwing,
    });
    assert.equal(production.code, "production_disabled");
    const adminDir = mkdtempSync(path.join(tmpdir(), "sa360-b2-admin-"));
    dirs.push(adminDir);
    const admin = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: adminDir,
      repoRoot,
      appId: ADMIN_APP_ID,
      token: "test-token",
      fetchImpl: throwing,
    });
    assert.equal(admin.code, "admin_app_forbidden");
    const operator = await executeCutover({ env: {}, stateDir: path.join(tmpdir(), "sa360-b2-missing-operator"), repoRoot, fetchImpl: throwing });
    assert.equal(operator.code, "operator_required");
    assert.equal(existsSync(path.join(tmpdir(), "sa360-b2-missing-operator")), false);
    const component = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator", DO_APP_NAME: "sa360" },
      stateDir: path.join(tmpdir(), "sa360-b2-component"),
      repoRoot,
      fetchImpl: throwing,
    });
    assert.equal(component.code, "component_environment");
    const forbidden = path.join(repoRoot, "scripts/boundary-b/operator-state");
    const inside = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: forbidden,
      repoRoot,
      fetchImpl: throwing,
    });
    assert.equal(inside.code, "state_dir_forbidden");
    assert.equal(existsSync(forbidden), false);
    const artifacts = "/opt/cursor/artifacts/b2-operator-state";
    const artifactResult = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: artifacts,
      repoRoot,
      fetchImpl: throwing,
    });
    assert.equal(artifactResult.code, "state_dir_forbidden");
    rmSync(artifacts, { recursive: true, force: true });
  });

  it("requires the pinned fingerprint before a production update", async () => {
    const platform = createPlatform("ok", PRODUCTION_APP_ID);
    const dir = mkdtempSync(path.join(tmpdir(), "sa360-b2-fingerprint-"));
    dirs.push(dir);
    let installs = 0;
    const report = await executeCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator", SA360_BOUNDARY_B_ALLOW_PRODUCTION: "yes" },
      stateDir: dir,
      repoRoot,
      appId: PRODUCTION_APP_ID,
      apiBase: "http://fake.invalid",
      token: "test-token",
      fetchImpl: platform.fetchImpl,
      installPassword: async () => { installs += 1; return { ok: false, code: "password_not_changed" }; },
    });
    assert.equal(report.code, "fingerprint_mismatch");
    assert.notEqual(specFingerprint(platform.original), PINNED_SA360_FINGERPRINT);
    assert.equal(installs, 0);
    assert.equal(platform.state.calls.every((call) => call.method === "GET"), true);
  });

  it("rejects insecure admin settings before the password helper runs", async () => {
    const cases = [
      [ADMIN_URL.replace("sslmode=require", "sslmode=disable"), "operator_tls_required"],
      [`${ADMIN_URL}&gssencmode=prefer`, "operator_tls_weakened"],
      [ADMIN_URL, "tls_root_cert_missing"],
    ];
    for (const [adminUrl, code] of cases) {
      const platform = createPlatform("ok");
      platform.state.spec = fixtureSpec(adminUrl);
      platform.state.original = structuredClone(platform.state.spec);
      const dir = mkdtempSync(path.join(tmpdir(), "sa360-b2-tls-guard-"));
      dirs.push(dir);
      const marker = path.join(dir, "helper-ran");
      const helper = path.join(dir, "marker-helper.sh");
      writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
      const report = await executeCutover({
        env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
        stateDir: dir,
        repoRoot,
        appId: APP,
        apiBase: "http://fake.invalid",
        token: "test-token",
        maxPolls: 2,
        pollIntervalMs: 0,
        helperPath: helper,
        fetchImpl: platform.fetchImpl,
      });
      assert.equal(report.code, code);
      assert.equal(existsSync(marker), false);
      assert.equal(existsSync(path.join(dir, "spec.json")), false);
      assert.equal(platform.state.calls.some((call) => call.method === "PUT"), false);
      assertReportClean(report, dir);
    }
    const missingGss = operatorConnectionPolicy("host=db.example port=25060 user=doadmin dbname=defaultdb sslmode=verify-full sslrootcert=/tmp/ca.crt");
    assert.equal(missingGss.code, "operator_tls_required");
    const preferred = operatorConnectionPolicy("host=db.example port=25060 user=doadmin dbname=defaultdb sslmode=verify-full gssencmode=prefer sslrootcert=/tmp/ca.crt");
    assert.equal(preferred.code, "operator_tls_weakened");
  });

  it("preview does not validate, install, or update", async () => {
    const platform = createPlatform("ok");
    const dir = mkdtempSync(path.join(tmpdir(), "sa360-b2-preview-"));
    dirs.push(dir);
    const report = await previewCutover({
      env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
      stateDir: dir,
      repoRoot,
      appId: APP,
      apiBase: "http://fake.invalid",
      token: "test-token",
      fetchImpl: platform.fetchImpl,
      persist: true,
    });
    assert.equal(report.code, "preview");
    assert.equal(platform.state.calls.length, 1);
    assert.equal(platform.state.calls[0].method, "GET");
    const saved = readFileSync(path.join(dir, "spec.json"), "utf8");
    assertHidden(!saved.includes("b2-preview-placeholder"), "preview credential was stored");
    assert.equal(statSync(path.join(dir, "spec.json")).mode & 0o777, 0o600);
  });

  it("the CLI refuses production before any network call", () => {
    const home = mkdtempSync(path.join(tmpdir(), "sa360-b2-home-"));
    dirs.push(home);
    const result = spawnSync(process.execPath, [path.join(here, "controller.mjs"), "execute"], {
      encoding: "utf8",
      env: {
        HOME: home,
        PATH: process.env.PATH,
        SA360_BOUNDARY_B_OPERATOR: "operator",
        DIGITALOCEAN_ACCESS_TOKEN: "canary-token-value",
        SA360_BOUNDARY_B_API_BASE: "http://127.0.0.1:9",
      },
    });
    assert.equal(result.status, 2);
    assert.match(result.stdout, /production_disabled/);
    assertHidden(!`${result.stdout}${result.stderr}`.includes("canary-token-value"), "cli printed token");
    const cleanHome = mkdtempSync(path.join(tmpdir(), "sa360-b2-home-"));
    dirs.push(cleanHome);
    const missing = spawnSync(process.execPath, [path.join(here, "controller.mjs"), "execute"], {
      encoding: "utf8",
      env: { HOME: cleanHome, PATH: process.env.PATH, SA360_BOUNDARY_B_API_BASE: "http://127.0.0.1:9" },
    });
    assert.match(missing.stdout, /operator_required/);
    assert.equal(existsSync(path.join(cleanHome, ".sa360-boundary-b")), false);
  });
});

describe("boundary B password installation", () => {
  let database;
  let helperPath;

  before(async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), "sa360-b2-bin-"));
    helperPath = path.join(binDir, "pq-change-password");
    const compiled = spawnSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", helperPath, path.join(here, "pq-change-password.c"), "-I/usr/include/postgresql", "-lpq"], { encoding: "utf8" });
    if (compiled.status !== 0) throw new Error(`compile failed: ${compiled.stderr}`);
    database = await startDisposablePostgres();
  });

  after(() => {
    if (!database) return;
    spawnSync(`${PG_BIN}/pg_ctl`, ["-D", database.dir, "-m", "fast", "stop"], { encoding: "utf8", env: cleanEnv() });
    rmSync(database.dir, { recursive: true, force: true });
  });

  it("rejects sslmode=disable and a production-flag disposable session before any connection", async () => {
    const proxy = await startProxy(database.port);
    const marker = path.join(database.dir, "helper-ran");
    const helper = path.join(database.dir, "marker-helper.sh");
    writeFileSync(helper, `#!/bin/sh\ntouch '${marker}'\n`, { mode: 0o700 });
    const disabled = await changePasswordWithLibpq({
      helperPath: helper,
      role: "sa360_app",
      password: generatePassword(),
      host: "127.0.0.1",
      port: proxy.port,
      adminUser: "b2admin",
      adminPassword: database.adminPassword,
      database: "postgres",
      sslmode: "disable",
    });
    assert.equal(disabled.code, "operator_tls_required");
    assert.equal(existsSync(marker), false);
    assert.equal(proxy.bytes().length, 0);
    const previous = process.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION;
    process.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION = "yes";
    try {
      const blocked = await changePasswordWithLibpq({
        helperPath,
        role: "sa360_app",
        password: generatePassword(),
        host: "127.0.0.1",
        port: proxy.port,
        adminUser: "b2admin",
        adminPassword: database.adminPassword,
        database: "postgres",
        sslmode: "disable",
        disposableLoopback: true,
      });
      assert.equal(blocked.code, "operator_tls_required");
      assert.equal(proxy.bytes().length, 0);
    } finally {
      if (previous === undefined) delete process.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION;
      else process.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION = previous;
    }
    const absent = spawnSync(helperPath, [], {
      encoding: "utf8",
      input: `${generatePassword()}\n`,
      env: {
        PATH: process.env.PATH,
        HOME: database.dir,
        SA360_PASSWORD_ROLE: "sa360_app",
        PGHOST: "127.0.0.1",
        PGPORT: String(proxy.port),
        PGUSER: "b2admin",
        PGDATABASE: "postgres",
        PGSSLMODE: "disable",
        PGGSSENCMODE: "prefer",
      },
    });
    assert.equal(absent.status, 3);
    assert.equal(absent.stdout, "refused\n");
    assert.equal(absent.stderr, "");
    assert.equal(proxy.bytes().length, 0);
    proxy.close();
  });

  it("sends a verifier, not the plaintext, and the controller can roll back without the database host", async () => {
    const shown = localSql(database, "SHOW password_encryption");
    assert.equal(shown.stdout.trim(), "md5");
    const password = generatePassword();
    assertHidden(/^[A-Za-z0-9_-]{43}$/.test(password), "password format");
    assertHidden(generatePassword() !== password, "password repeated");
    const proxy = await startProxy(database.port);
    const readyFile = path.join(database.dir, "ready");
    const releaseFile = path.join(database.dir, "release");
    const logStart = statSync(database.log).size;
    const installed = await changePasswordWithLibpq({
      helperPath,
      role: "sa360_app",
      password,
      host: "127.0.0.1",
      port: proxy.port,
      adminUser: "b2admin",
      adminPassword: database.adminPassword,
      database: "postgres",
      sslmode: "disable",
      disposableLoopback: true,
      hold: {
        readyFile,
        releaseFile,
        async onReady(pid) {
          const cmdline = readFileSync(`/proc/${pid}/cmdline`);
          const environ = readFileSync(`/proc/${pid}/environ`);
          assertHidden(!cmdline.includes(Buffer.from(password)), "password in argv");
          assertHidden(!environ.includes(Buffer.from(password)), "password in environ");
          assertHidden(!environ.includes(Buffer.from("PGPASSWORD=")), "PGPASSWORD in environ");
          const passfile = environ.toString("utf8").split("\0").find((item) => item.startsWith("PGPASSFILE="))?.slice("PGPASSFILE=".length);
          const pgpass = readFileSync(passfile, "utf8");
          assertHidden(pgpass.includes(escapePgpass(database.adminPassword)), "pgpass missing admin");
          assertHidden(!pgpass.includes(password), "pgpass contains new credential");
        },
      },
    });
    assert.equal(installed.code, "password_installed");
    const wire = proxy.bytes().toString("utf8");
    const logged = readFileSync(database.log).subarray(logStart).toString("utf8");
    assertHidden(!wire.includes(password) && !logged.includes(password), "plaintext reached postgres");
    assertHidden(!wire.includes(database.adminPassword) && !logged.includes(database.adminPassword), "admin credential reached postgres");
    assertHidden(/PASSWORD\s+'md5[0-9a-f]{32}'/.test(logged), "verifier was not sent");
    assertHidden(wire.includes("PASSWORD") && wire.includes("md5"), "verifier was not on the wire");
    proxy.clear();
    const shape = localSql(database, "SELECT left(rolpassword, 3) || '|' || length(rolpassword)::text FROM pg_authid WHERE rolname = 'sa360_app'");
    assert.equal(shape.stdout.trim(), "md5|35");
    const stored = localSql(database, "SELECT rolpassword FROM pg_authid WHERE rolname = 'sa360_app'");
    assertHidden(stored.stdout.trim().startsWith("md5") && !stored.stdout.includes(password), "stored verifier contains plaintext");
    const probe = await runProbe(buildLoginUrl(`postgresql://b2admin:${encodeURIComponent(database.adminPassword)}@127.0.0.1:${database.port}/postgres?sslmode=disable`, "sa360_app", password), [
      { name: "identity", sql: "SELECT current_user", expect: "text", accept: ["sa360_app"] },
      { name: "lead", sql: "SELECT count(*) FROM lead_probe", expect: "ok" },
      { name: "secret", sql: "SELECT count(*) FROM secret_probe", expect: "denied" },
      { name: "create", sql: "CREATE TABLE boundary_b_should_fail(id int)", expect: "denied" },
    ], { disposableLoopback: true });
    assert.deepEqual(probe.results, [
      { name: "identity", ok: true },
      { name: "lead", ok: true },
      { name: "secret", ok: true },
      { name: "create", ok: true },
    ]);
    const extra = spawnSync(helperPath, ["canary-argument"], { encoding: "utf8", input: `${password}\n`, env: { SA360_PASSWORD_ROLE: "sa360_app" } });
    assert.equal(extra.status, 2);
    proxy.close();

    localSql(database, "CREATE ROLE sa360_scram LOGIN");
    localSql(database, "ALTER SYSTEM SET password_encryption = 'scram-sha-256'");
    localSql(database, "SELECT pg_reload_conf()");
    const scramShown = localSql(database, "SHOW password_encryption");
    assert.equal(scramShown.stdout.trim(), "scram-sha-256");
    const scramPassword = "b2-scram-password-value-not-for-prod";
    const scramLog = statSync(database.log).size;
    const refused = await changePasswordWithLibpq({
      helperPath,
      role: "sa360_scram",
      password: scramPassword,
      host: "127.0.0.1",
      port: database.port,
      adminUser: "b2admin",
      adminPassword: database.adminPassword,
      database: "postgres",
      sslmode: "disable",
      disposableLoopback: true,
    });
    assert.equal(refused.code, "password_not_changed");
    const scramStored = localSql(database, "SELECT COALESCE(rolpassword, 'null') FROM pg_authid WHERE rolname = 'sa360_scram'");
    assert.equal(scramStored.stdout.trim(), "null");
    const scramLogged = readFileSync(database.log).subarray(scramLog).toString("utf8");
    assertHidden(!scramLogged.includes(scramPassword), "refused password reached the log");
    localSql(database, "ALTER SYSTEM SET password_encryption = 'md5'");
    localSql(database, "SELECT pg_reload_conf()");
    assert.equal(localSql(database, "SHOW password_encryption").stdout.trim(), "md5");

    const adminUrl = `postgresql://b2admin:${encodeURIComponent(database.adminPassword)}@127.0.0.1:${database.port}/postgres?sslmode=disable`;
    const platform = createPlatform("deploy_fails");
    platform.state.spec = fixtureSpec(adminUrl);
    platform.state.original = structuredClone(platform.state.spec);
    const dir = mkdtempSync(path.join(tmpdir(), "sa360-b2-e2e-"));
    try {
      const report = await executeCutover({
        env: { SA360_BOUNDARY_B_OPERATOR: "operator" },
        stateDir: dir,
        repoRoot,
        appId: APP,
        apiBase: "http://fake.invalid",
        token: "test-token",
        maxPolls: 3,
        pollIntervalMs: 0,
        helperPath,
        fetchImpl: platform.fetchImpl,
        installPassword: async ({ adminUrl }) => {
          const admin = new URL(adminUrl);
          const installedPassword = generatePassword();
          const installed = await changePasswordWithLibpq({
            helperPath,
            role: "sa360_app",
            password: installedPassword,
            host: admin.hostname,
            port: admin.port,
            adminUser: decodeURIComponent(admin.username),
            adminPassword: decodeURIComponent(admin.password),
            database: decodeURIComponent(admin.pathname.replace(/^\//, "")),
            sslmode: "disable",
            disposableLoopback: true,
          });
          if (!installed.ok) return installed;
          return { ok: true, password: installedPassword, url: buildLoginUrl(adminUrl, "sa360_app", installedPassword) };
        },
        probe: (url) => runProbe(url, [
          { name: "identity", sql: "SELECT current_user", expect: "text", accept: ["sa360_app"] },
          { name: "secret", sql: "SELECT count(*) FROM secret_probe", expect: "denied" },
        ], { disposableLoopback: true }),
      });
      assert.equal(report.code, "recovered");
      assert.equal(report.recovery, "rollback");
      assertHidden(!JSON.stringify(report).includes(database.adminPassword), "report contains admin credential");
      assertHidden(!JSON.stringify(report).includes("postgresql://"), "report contains url");
      const saved = readFileSync(path.join(dir, "spec.json"), "utf8");
      assertHidden(!saved.includes("sa360_app"), "saved spec contains the new login");
      const rollback = platform.state.calls.find((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate"));
      assert.equal(rollback.body.skip_pin, true);
      assert.equal(rollback.body.deployment_id, "dep-before");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("boundary B post-ACTIVE validation", () => {
  function failing(mutate) {
    const evidence = passingPostActiveEvidence();
    mutate(evidence);
    return async () => evidence;
  }

  it("accepts only component-console evidence", () => {
    assert.equal(evaluatePostActive(passingPostActiveEvidence()).ok, true);
    const operator = passingPostActiveEvidence();
    operator.api.source = "operator_probe";
    const rejected = evaluatePostActive(operator);
    assert.equal(rejected.ok, false);
    assert.equal(rejected.failures.includes("api_identity"), true);
    const prefixed = `\u001b[?2004l\rCOMPONENT_${"REPORT"} ${JSON.stringify({
      user: "sa360_app",
      database: "defaultdb",
      port: 25060,
      ssl: true,
      grants_ok: true,
      summary_functions: 0,
      summary_triggers: 0,
      projection: { ready: true, counts_match: true, triggers_enabled: 3 },
      paths: { intake: true, sheets: true, onboarding: true },
    })}`;
    const parsed = parseComponentReport(prefixed);
    assert.equal(parsed.user, "sa360_app");
    assert.equal(parsed.source, "component_console");
    assert.equal(parseSummaryRow("SET\n"), null);
    assert.deepEqual(parseSummaryRow("SET\nf|0\n"), { ready: false, functions: 0 });
    const migrate = migrateEvidenceFromLog("94 migrations found\nNo pending migrations to apply.\n", { appUser: "doadmin", migrateOverride: false });
    assert.equal(migrate.identity, "doadmin");
    assert.equal(migrate.identity_source, "catalog_read");
    assert.equal(migrateEvidenceFromLog("permission denied for table _prisma_migrations", { appUser: "doadmin", migrateOverride: false }).completed, false);
    assert.equal(migrateEvidenceFromLog("Applying migration 20261027000000_new\nAll migrations have been successfully applied.", { appUser: "doadmin", migrateOverride: false }).completed, false);
    const partial = `COMPONENT_${"REPORT"} {"user":"sa360_app","projection":{"ready":true}`;
    assert.equal(completeComponentLine(partial), null);
    const finished = `${partial},"paths":{"sheets":true}}\n`;
    assert.equal(JSON.parse(completeComponentLine(finished).slice(`COMPONENT_${"REPORT"} `.length)).paths.sheets, true);
    assert.equal(migrateEvidenceFromLog("No pending migrations to apply.", { appUser: "doadmin", migrateOverride: true }).identity, null);
    assert.equal(classifyMigrationLog("94 migrations found\nNo pending migrations to apply.\n"), "no_pending");
    assert.equal(classifyMigrationLog("Applying migration `20261027000000_example`\nAll migrations have been successfully applied.\n"), "applied");
    assert.equal(classifyMigrationLog("Error: P3009\nmigrate found failed migrations in the target database\n"), "failed");
    assert.equal(classifyMigrationLog("permission denied for table _prisma_migrations"), "failed");
    assert.equal(classifyMigrationLog(""), "missing");
    assert.equal(classifyMigrationLog("94 migrations found in prisma/migrations\n"), "incomplete");
    assert.equal(migrateEvidenceFromLog("Applying migration `20261027000000_example`\nNo pending migrations to apply.\n", { appUser: "doadmin", migrateOverride: false }).classification, "ambiguous");
    assert.equal(healthTargets({}).code, "post_active_unconfigured");
    const commands = consoleCommands(componentScript);
    assert.equal(commands.join("\n").includes("postgres://"), false);
    assert.equal(componentScript.includes(`COMPONENT_${"REPORT"} `), false);
  });

  it("reads public health without treating an operator connection as a component", async () => {
    const pages = {
      "https://api.example/health": { ok: true, service: "api" },
      "https://api.example/health/db": { ok: true, db: "connected" },
      "https://api.example/health/queue": { ok: true, queue: "PONG" },
      "https://portal.example/api/health": { ok: true, service: "admin-coc" },
    };
    const health = await readPublicHealth(async (url) => ({ status: 200, json: async () => pages[url] }), {
      apiBase: "https://api.example",
      adminHealth: "https://portal.example/api/health",
    });
    assert.deepEqual(health, { api: true, database: true, queue: true, admin: true });
    let output = "";
    const socket = await openConsole("wss://console.example/exec", ["printf ok"], class FakeSocket {
      addEventListener(name, fn) { this[name] = fn; }
      send() {}
      close() { this.closeEvent?.(); }
      constructor() {
        queueMicrotask(() => {
          this.open?.();
          this.message?.({ data: JSON.stringify({ data: `\u001b[?2004lCOMPONENT_${"REPORT"} {"user":"doadmin"}\n` }) });
        });
      }
    });
    output = socket;
    assert.equal(parseComponentReport(output).user, "doadmin");
    const marker = `COMPONENT_${"REPORT"} `;
    const split = await openConsole("wss://console.example/exec", ["printf ok"], class SplitSocket {
      addEventListener(name, fn) { this[name] = fn; }
      send() {}
      close() {}
      constructor() {
        queueMicrotask(() => {
          this.open?.();
          this.message?.({ data: JSON.stringify({ data: `${marker}{"user":"sa360_app","projection":{"ready":true}` }) });
          this.message?.({ data: JSON.stringify({ data: `,"paths":{"sheets":true}}\n` }) });
        });
      }
    });
    assert.equal(parseComponentReport(split).paths.sheets, true);
  });

  it("reads a live migrate log when the archive has no terminal result", async () => {
    assert.deepEqual(migrationLogLocations({ historic_urls: ["http://logs.example/open"], live_url: "https://logs.example/live" }), {
      historic: [],
      live: "https://logs.example/live",
    });
    const archived = "94 migrations found\nNo pending migrations to apply.\n";
    const calls = [];
    const fetchImpl = async (url) => {
      calls.push(url);
      const body = url.endsWith("/archive")
        ? archived
        : url.endsWith("/partial")
          ? "94 migrations found\n"
          : "Applying migration `20261027000000_example`\nAll migrations have been successfully applied.\n";
      return { ok: true, text: async () => body };
    };
    const archivedLog = await collectMigrationLog(fetchImpl, {
      historic_urls: ["https://logs.example/archive"],
      live_url: "https://logs.example/live",
    });
    assert.deepEqual(calls, ["https://logs.example/archive"]);
    assert.equal(migrateEvidenceFromLog(archivedLog, { appUser: "doadmin", migrateOverride: false }).classification, "no_pending");
    const liveLog = await collectMigrationLog(fetchImpl, { historic_urls: [], live_url: "https://logs.example/live" });
    assert.equal(calls.at(-1), "https://logs.example/live");
    assert.equal(migrateEvidenceFromLog(liveLog, { appUser: "doadmin", migrateOverride: false }).classification, "applied");
    const partial = await collectMigrationLog(fetchImpl, {
      historic_urls: ["https://logs.example/partial"],
      live_url: "https://logs.example/live",
    });
    assert.equal(classifyMigrationLog(partial), "applied");
    const hanging = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("94 migrations found\nNo pending migrations to apply.\n"));
      },
    });
    const bounded = await readLogBody({ ok: true, body: hanging }, { idleMs: 30, timeoutMs: 200 });
    assert.equal(classifyMigrationLog(bounded), "no_pending");
  });

  async function expectRecovery(label, mode, mutate) {
    const result = await runMode(mode, { collectPostActive: failing(mutate) });
    assert.equal(result.report.code, "recovered", label);
    assert.equal(result.installs, 1, label);
    assert.equal(result.report.problems.includes(label) || result.report.problems.length > 0, true, label);
    return result;
  }

  it("recovers an API identity mismatch without a second password", async () => {
    const result = await expectRecovery("api_identity", "ok", (evidence) => { evidence.api.user = "doadmin"; });
    assert.equal(result.report.problems.includes("api_identity"), true);
    assert.equal(result.platform.state.calls.filter((call) => call.path.endsWith("/rollback") && !call.path.endsWith("/validate")).length, 1);
  });

  it("recovers a worker identity mismatch", async () => {
    const result = await expectRecovery("worker_identity", "ok", (evidence) => { evidence.worker.user = "doadmin"; });
    assert.equal(result.report.problems.includes("worker_identity"), true);
  });

  it("recovers a failed migration, an unhealthy queue, and a Sheets permission failure", async () => {
    const migration = await expectRecovery("migrate_completed", "ok", (evidence) => { evidence.migrate.completed = false; evidence.migrate.identity = null; evidence.migrate.identity_source = null; });
    assert.equal(migration.report.problems.includes("migrate_completed"), true);
    const queue = await expectRecovery("queue_health", "ok", (evidence) => { evidence.health.queue = false; });
    assert.equal(queue.report.problems.includes("queue_health"), true);
    const sheets = await expectRecovery("sheets_path", "ok", (evidence) => { evidence.api.paths.sheets = false; });
    assert.equal(sheets.report.problems.includes("sheets_path"), true);
  });

  it("recovers when ACTIVE runtime configuration is wrong", async () => {
    const result = await expectRecovery("summary_inactive", "ok", (evidence) => { evidence.summary.ready = true; });
    assert.equal(result.report.problems.includes("summary_inactive"), true);
    assert.equal(result.installs, 1);
  });

  it("recovers a lost post-ACTIVE response from the saved spec", async () => {
    const result = await runMode("ok", { collectPostActive: async () => { throw Object.assign(new Error("http_lost"), { code: "http_lost" }); } });
    assert.equal(result.report.code, "recovered");
    assert.equal(result.report.problems.includes("post_active_lost"), true);
    assert.equal(result.installs, 1);
    assert.equal(result.platform.state.spec.services[0].envs.some((env) => env.key === "DATABASE_URL"), false);
  });

  it("reports an ambiguous rollback when recovery cannot see the saved spec", async () => {
    let puts = 0;
    const result = await runMode("ok", {
      collectPostActive: failing((evidence) => { evidence.api.user = "doadmin"; }),
      wrapFetch(inner) {
        return async (url, options = {}) => {
          const method = options.method ?? "GET";
          const requestPath = new URL(url).pathname;
          if (method === "POST" && requestPath.endsWith("/rollback") && !requestPath.endsWith("/validate")) {
            throw new Error("socket hang up fixture-canary-do-not-print");
          }
          if (method === "PUT") {
            puts += 1;
            if (puts > 1) throw new Error("socket hang up fixture-canary-do-not-print");
          }
          return inner(url, options);
        };
      },
    });
    assert.equal(result.report.code, "fallback_ambiguous");
    assert.equal(result.report.ok, false);
    assert.equal(result.installs, 1);
    assert.equal(result.report.problems.includes("api_identity"), true);
    assert.equal(result.platform.state.spec.services[0].envs.some((env) => env.key === "DATABASE_URL"), true);
  });

  it("uses one saved-spec update when rollback is lost", async () => {
    const result = await runMode("ok", {
      collectPostActive: failing((evidence) => { evidence.worker.source = "operator_probe"; }),
      wrapFetch(inner) {
        return async (url, options = {}) => {
          const method = options.method ?? "GET";
          const requestPath = new URL(url).pathname;
          if (method === "POST" && requestPath.endsWith("/rollback") && !requestPath.endsWith("/validate")) {
            throw new Error("socket hang up fixture-canary-do-not-print");
          }
          return inner(url, options);
        };
      },
    });
    assert.equal(result.report.code, "recovered");
    assert.equal(result.report.recovery, "saved_spec");
    assert.equal(result.installs, 1);
    assert.equal(result.report.problems.includes("worker_identity"), true);
  });
});

describe("boundary B runbook", () => {
  it("names the executable checks and does not describe plaintext submission", () => {
    const text = readFileSync(runbookPath, "utf8");
    assert.match(text, /outside the App Platform components/);
    assert.match(text, /PQchangePassword/);
    assert.match(text, /full-structure comparison/);
    assert.match(text, /Sam-Workstation/);
    assert.match(text, /Ubuntu 24\.04/);
    assert.match(text, /SA360_BOUNDARY_B_ROOT_CERT/);
    assert.match(text, /sslmode=verify-full/);
    assert.match(text, /gssencmode=disable/);
    for (const check of productionProbeChecks) assert.equal(text.includes(check.name), true, check.name);
    assert.equal(text.includes("summary_ready = true"), false);
    assert.equal(text.includes("Pipe "), false);
    const probeSource = readFileSync(path.join(here, "probe.mjs"), "utf8");
    assert.equal(probeSource.includes("summary_ready = true"), false);
    assert.equal(probeSource.includes("CALL "), false);
  });
});

describe("boundary B verified operator TLS", () => {
  let database;
  let helperPath;

  before(async () => {
    const binDir = mkdtempSync(path.join(tmpdir(), "sa360-b2-tls-bin-"));
    helperPath = path.join(binDir, "pq-change-password");
    const compiled = spawnSync("cc", ["-O2", "-Wall", "-Wextra", "-Werror", "-o", helperPath, path.join(here, "pq-change-password.c"), "-I/usr/include/postgresql", "-lpq"], { encoding: "utf8" });
    if (compiled.status !== 0) throw new Error(`compile failed: ${compiled.stderr}`);
    database = await startTlsPostgres();
  });

  after(() => {
    if (!database) return;
    spawnSync(`${PG_BIN}/pg_ctl`, ["-D", database.dir, "-m", "fast", "stop"], { encoding: "utf8", env: cleanEnv() });
    rmSync(database.root, { recursive: true, force: true });
  });

  function requireUrl(hostname) {
    return `postgresql://b2admin:${encodeURIComponent(database.adminPassword)}@${hostname}:${database.port}/postgres?sslmode=require`;
  }

  it("fails closed when the CA is missing", async () => {
    const missing = await runProbe(requireUrl("db.example"), [{ name: "ok", sql: "SELECT 1", expect: "text", accept: ["1"] }]);
    assert.equal(missing.ok, false);
    assert.equal(missing.code, "tls_root_cert_missing");
    assert.deepEqual(missing.results, []);
    const helper = await changePasswordWithLibpq({
      helperPath,
      role: "tls_target",
      password: generatePassword(),
      host: "db.example",
      port: database.port,
      adminUser: "b2admin",
      adminPassword: database.adminPassword,
      database: "postgres",
      sslmode: "require",
      rootCert: path.join(database.dir, "missing-ca.crt"),
      hostaddr: "127.0.0.1",
    });
    assert.equal(helper.code, "tls_root_cert_missing");
  });

  it("fails closed for the wrong CA", async () => {
    const before = localSql(database, "SELECT COALESCE(rolpassword, 'null') FROM pg_authid WHERE rolname = 'tls_target'");
    const probe = await runProbe(requireUrl("db.example"), [{ name: "ok", sql: "SELECT 1", expect: "text", accept: ["1"] }], {
      rootCert: database.certs.wrongCa,
      hostaddr: "127.0.0.1",
    });
    assert.equal(probe.ok, false);
    const installed = await changePasswordWithLibpq({
      helperPath,
      role: "tls_target",
      password: generatePassword(),
      host: "db.example",
      port: database.port,
      adminUser: "b2admin",
      adminPassword: database.adminPassword,
      database: "postgres",
      sslmode: "require",
      rootCert: database.certs.wrongCa,
      hostaddr: "127.0.0.1",
    });
    assert.equal(installed.ok, false);
    const after = localSql(database, "SELECT COALESCE(rolpassword, 'null') FROM pg_authid WHERE rolname = 'tls_target'");
    assert.equal(after.stdout, before.stdout);
  });

  it("fails closed for the wrong hostname", async () => {
    const probe = await runProbe(requireUrl("wrong.example"), [{ name: "ok", sql: "SELECT 1", expect: "text", accept: ["1"] }], {
      rootCert: database.certs.caCert,
      hostaddr: "127.0.0.1",
    });
    assert.equal(probe.ok, false);
  });

  it("accepts the matching CA and hostname without letting require disable verification", async () => {
    const verified = operatorVerifyFull({
      host: "db.example",
      port: String(database.port),
      user: "b2admin",
      database: "postgres",
      rootCert: database.certs.caCert,
      hostaddr: "127.0.0.1",
    });
    assert.equal(verified.ok, true);
    assert.match(verified.conninfo, /sslmode=verify-full/);
    assert.match(verified.conninfo, /gssencmode=disable/);
    assert.equal(verified.conninfo.includes("sslmode=require"), false);
    assert.equal(operatorConnectionPolicy(verified.conninfo).ok, true);
    assert.equal(verified.env.PGGSSENCMODE, "disable");
    assert.equal(verified.env.PGSSLMODE, "verify-full");
    const pgpass = path.join(database.dir, "operator.pgpass");
    writeFileSync(pgpass, `db.example:${database.port}:postgres:b2admin:${escapePgpass(database.adminPassword)}\n`, { mode: 0o600 });
    const downgraded = spawnSync("psql", ["-X", "-q", "-t", "-A", "-d", verified.conninfo, "-c", "SELECT COALESCE((SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()), 'off') || '|' || COALESCE((SELECT CASE WHEN encrypted THEN 'gss' ELSE 'clear' END FROM pg_stat_gssapi WHERE pid = pg_backend_pid()), 'none')"], {
      encoding: "utf8",
      env: { ...cleanEnv(), PGSSLMODE: "require", PGGSSENCMODE: "prefer", PGPASSFILE: pgpass, HOME: database.dir },
    });
    assert.equal(downgraded.status, 0, downgraded.stderr);
    const transport = downgraded.stdout.trim();
    assert.equal(["true|clear", "t|clear", "true|none", "t|none"].includes(transport), true, transport);
    assert.equal(transport.includes("gss"), false);
    assertHidden(!`${downgraded.stdout}${downgraded.stderr}`.includes(database.adminPassword), "psql printed admin credential");
    const probe = await runProbe(requireUrl("db.example"), [{ name: "ok", sql: "SELECT 1", expect: "text", accept: ["1"] }], {
      rootCert: database.certs.caCert,
      hostaddr: "127.0.0.1",
    });
    assert.deepEqual(probe.results, [{ name: "ok", ok: true }]);
    const password = generatePassword();
    const readyFile = path.join(database.root, "tls-ready");
    const releaseFile = path.join(database.root, "tls-release");
    const previousGss = process.env.PGGSSENCMODE;
    const previousSsl = process.env.PGSSLMODE;
    process.env.PGGSSENCMODE = "prefer";
    process.env.PGSSLMODE = "disable";
    let installed;
    try {
      installed = await changePasswordWithLibpq({
        helperPath,
        role: "tls_target",
        password,
        host: "db.example",
        port: database.port,
        adminUser: "b2admin",
        adminPassword: database.adminPassword,
        database: "postgres",
        sslmode: "require",
        rootCert: database.certs.caCert,
        hostaddr: "127.0.0.1",
        hold: {
          readyFile,
          releaseFile,
          onReady(pid) {
            const environ = readFileSync(`/proc/${pid}/environ`).toString("utf8").split("\0");
            assert.equal(environ.includes("PGGSSENCMODE=disable"), true);
            assert.equal(environ.includes("PGSSLMODE=verify-full"), true);
            assert.equal(environ.includes("SA360_BOUNDARY_B_TLS=verify-full"), true);
            assert.equal(environ.includes("PGGSSENCMODE=prefer"), false);
            assert.equal(environ.includes("PGSSLMODE=disable"), false);
            assert.equal(environ.some((item) => item.startsWith("PGPASSWORD=")), false);
            assertHidden(!environ.some((item) => item.includes(password)), "password in helper environ");
          },
        },
      });
    } finally {
      if (previousGss === undefined) delete process.env.PGGSSENCMODE;
      else process.env.PGGSSENCMODE = previousGss;
      if (previousSsl === undefined) delete process.env.PGSSLMODE;
      else process.env.PGSSLMODE = previousSsl;
    }
    assert.equal(installed.code, "password_installed");
    assertHidden(!JSON.stringify(installed).includes(password), "installer returned plaintext");
    assert.equal(localSql(database, "SELECT left(rolpassword, 3) FROM pg_authid WHERE rolname = 'tls_target'").stdout.trim(), "md5");
  });

  it("rejects unreadable, linked, and unsafe CA files without revealing the path", () => {
    const readable = validateOperatorCa(database.certs.caCert);
    assert.equal(readable.ok, true);
    const link = path.join(database.root, "ca-link.crt");
    symlinkSync(database.certs.caCert, link);
    const linked = validateOperatorCa(link);
    assert.equal(linked.ok, false);
    assert.equal(linked.code, "tls_root_cert_unsafe");
    assert.equal(JSON.stringify(linked).includes("ca-link"), false);
    const copy = path.join(database.root, "ca-unreadable.crt");
    writeFileSync(copy, readFileSync(database.certs.caCert), { mode: 0o600 });
    chmodSync(copy, 0o000);
    try {
      const unreadable = validateOperatorCa(copy);
      assert.equal(unreadable.code, "tls_root_cert_unsafe");
      assert.equal(JSON.stringify(unreadable).includes("ca-unreadable"), false);
    } finally {
      chmodSync(copy, 0o600);
    }
    const openDir = path.join(database.root, "open-ca");
    mkdirSync(openDir, { mode: 0o777 });
    chmodSync(openDir, 0o777);
    const loose = path.join(openDir, "ca.crt");
    writeFileSync(loose, readFileSync(database.certs.caCert), { mode: 0o600 });
    chmodSync(loose, 0o600);
    assert.equal(validateOperatorCa(loose).code, "tls_root_cert_unsafe");
    const grouped = path.join(database.root, "ca-group.crt");
    writeFileSync(grouped, readFileSync(database.certs.caCert), { mode: 0o600 });
    chmodSync(grouped, 0o660);
    assert.equal(validateOperatorCa(grouped).code, "tls_root_cert_unsafe");
    const inside = validateOperatorCa(database.certs.caCert, { repoRoot: path.dirname(database.certs.caCert) });
    assert.equal(inside.code, "tls_root_cert_forbidden");
    assert.equal(JSON.stringify(inside).includes(path.basename(database.certs.caCert)), false);
    assert.equal(productionAdminUrlAccepted(ADMIN_URL.replace("sslmode=require", "sslmode=disable")).code, "operator_tls_required");
  });

  it("keeps operator TLS out of the app spec and container rollback state", () => {
    const login = buildLoginUrl(ADMIN_URL, "sa360_app", PASSWORD);
    const planned = planDatabaseUrlOverrides(fixtureSpec(), login, { adminUser: "doadmin", production: true });
    assert.equal(planned.ok, true, planned.problems.join(","));
    assert.equal(new URL(login).searchParams.get("sslmode"), "require");
    assert.equal(new URL(login).searchParams.has("sslrootcert"), false);
    const deployed = planned.next.services.find((service) => service.name === "sa360-api").envs.at(-1).value;
    assert.equal(new URL(deployed).searchParams.get("sslmode"), "require");
    const serialized = JSON.stringify(planned.next);
    assert.equal(serialized.includes("verify-full"), false);
    assert.equal(serialized.includes("gssencmode"), false);
    assert.equal(serialized.includes("sslrootcert"), false);
    assert.equal(serialized.includes("PGSSLROOTCERT"), false);
    assert.equal(serialized.includes(database.certs.caCert), false);
    const sources = ["controller.mjs", "password-install.mjs", "probe.mjs", "spec-plan.mjs", "pq-change-password.c"]
      .map((name) => readFileSync(path.join(here, name), "utf8"))
      .join("\n");
    assert.equal(sources.includes("docker-desktop"), false);
    assert.equal(sources.includes("update-ca-certificates"), false);
    assert.equal(sources.includes("sslrootcert=system"), false);
    const saved = path.join(database.dir, "rollback-spec.json");
    writeFileSync(saved, "{}\n", { mode: 0o600 });
    assert.equal(statSync(saved).mode & 0o777, 0o600);
    assert.equal(saved.startsWith(repoRoot), false);
    assert.equal(saved.startsWith("/mnt/"), false);
  });
});

function cleanEnv() {
  return { PATH: process.env.PATH, HOME: tmpdir(), LANG: "C" };
}

function localSql(database, sql) {
  const result = spawnSync("psql", ["-h", database.dir, "-p", String(database.port), "-U", "b2admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-t", "-A", "-c", sql], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  if (result.status !== 0) throw new Error(`disposable sql failed: ${result.stderr}`);
  return result;
}

function writeTestCerts(dir) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const caKey = path.join(dir, "ca.key");
  const caCert = path.join(dir, "ca.crt");
  const serverKey = path.join(dir, "server.key");
  const serverCsr = path.join(dir, "server.csr");
  const serverCert = path.join(dir, "server.crt");
  const wrongKey = path.join(dir, "wrong.key");
  const wrongCa = path.join(dir, "wrong-ca.crt");
  const run = (args) => {
    const result = spawnSync("openssl", args, { encoding: "utf8", env: cleanEnv() });
    if (result.status !== 0) throw new Error(`openssl failed: ${result.stderr || result.stdout}`);
  };
  run(["req", "-new", "-x509", "-days", "2", "-nodes", "-keyout", caKey, "-out", caCert, "-subj", "/CN=boundary-b-test-ca"]);
  run(["req", "-new", "-nodes", "-keyout", serverKey, "-out", serverCsr, "-subj", "/CN=db.example", "-addext", "subjectAltName=DNS:db.example"]);
  run(["x509", "-req", "-in", serverCsr, "-CA", caCert, "-CAkey", caKey, "-CAcreateserial", "-out", serverCert, "-days", "2", "-copy_extensions", "copy"]);
  run(["req", "-new", "-x509", "-days", "2", "-nodes", "-keyout", wrongKey, "-out", wrongCa, "-subj", "/CN=boundary-b-wrong-ca"]);
  chmodSync(serverKey, 0o600);
  chmodSync(caKey, 0o600);
  chmodSync(wrongKey, 0o600);
  chmodSync(caCert, 0o600);
  chmodSync(wrongCa, 0o600);
  return { caCert, serverCert, serverKey, wrongCa };
}

async function startTlsPostgres() {
  const root = mkdtempSync(path.join(tmpdir(), "sa360-b2-tls-"));
  const dir = path.join(root, "data");
  const port = 54731;
  const certs = writeTestCerts(path.join(root, "certs"));
  const init = spawnSync(`${PG_BIN}/initdb`, ["-D", dir, "-U", "b2admin", "--auth-local=trust", "--auth-host=md5", "--no-sync", "--no-instructions"], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
  appendFileSync(path.join(dir, "postgresql.conf"), `
listen_addresses = '127.0.0.1'
port = ${port}
password_encryption = md5
unix_socket_directories = '${dir}'
ssl = on
ssl_cert_file = '${certs.serverCert}'
ssl_key_file = '${certs.serverKey}'
fsync = off
synchronous_commit = off
full_page_writes = off
shared_buffers = 16MB
log_statement = none
logging_collector = off
`);
  writeFileSync(path.join(dir, "pg_hba.conf"), "local all all trust\nhostssl all all 127.0.0.1/32 md5\nhost all all 127.0.0.1/32 reject\nhost all all ::1/128 reject\n");
  const log = path.join(dir, "server.log");
  const start = spawnSync(`${PG_BIN}/pg_ctl`, ["-D", dir, "-l", log, "-w", "-t", "30", "start"], { encoding: "utf8", env: cleanEnv() });
  if (start.status !== 0) throw new Error(`postgres failed to start: ${start.stderr || start.stdout}\n${existsSync(log) ? readFileSync(log, "utf8") : ""}`);
  const database = { dir, root, port, log, adminPassword: "b2-admin:secret", certs };
  const setup = spawnSync("psql", ["-h", dir, "-p", String(port), "-U", "b2admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    env: cleanEnv(),
    input: `ALTER ROLE b2admin PASSWORD '${database.adminPassword}';
CREATE ROLE tls_target LOGIN;
`,
  });
  if (setup.status !== 0) throw new Error(`tls setup failed: ${setup.stderr}`);
  return database;
}

async function startDisposablePostgres() {
  const dir = mkdtempSync(path.join(tmpdir(), "sa360-b2-pg-"));
  const port = 54729;
  const init = spawnSync(`${PG_BIN}/initdb`, ["-D", dir, "-U", "b2admin", "--auth-local=trust", "--auth-host=md5", "--no-sync", "--no-instructions"], {
    encoding: "utf8",
    env: cleanEnv(),
  });
  if (init.status !== 0) throw new Error(`initdb failed: ${init.stderr || init.stdout}`);
  appendFileSync(path.join(dir, "postgresql.conf"), `
listen_addresses = '127.0.0.1'
port = ${port}
password_encryption = md5
unix_socket_directories = '${dir}'
fsync = off
synchronous_commit = off
full_page_writes = off
shared_buffers = 16MB
log_statement = none
logging_collector = off
`);
  writeFileSync(path.join(dir, "pg_hba.conf"), "local all all trust\nhost all all 127.0.0.1/32 md5\nhost all all ::1/128 reject\n");
  const log = path.join(dir, "server.log");
  const start = spawnSync(`${PG_BIN}/pg_ctl`, ["-D", dir, "-l", log, "-w", "-t", "30", "start"], { encoding: "utf8", env: cleanEnv() });
  if (start.status !== 0) throw new Error(`postgres failed to start: ${start.stderr || start.stdout}`);
  const database = { dir, port, log, adminPassword: "b2-admin:secret" };
  const setup = spawnSync("psql", ["-h", dir, "-p", String(port), "-U", "b2admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-f", "-"], {
    encoding: "utf8",
    env: cleanEnv(),
    input: `ALTER ROLE b2admin PASSWORD '${database.adminPassword}';
CREATE ROLE sa360_app LOGIN;
CREATE TABLE lead_probe(id int);
INSERT INTO lead_probe VALUES (1);
GRANT SELECT ON lead_probe TO sa360_app;
CREATE TABLE secret_probe(id int);
REVOKE ALL ON secret_probe FROM PUBLIC;
`,
  });
  if (setup.status !== 0) throw new Error("disposable setup failed");
  localSql(database, "ALTER SYSTEM SET log_statement = 'all'");
  const logging = localSql(database, "SELECT pg_reload_conf()");
  if (!logging.stdout.includes("t")) throw new Error("log reload failed");
  return database;
}

function startProxy(targetPort) {
  const chunks = [];
  const server = net.createServer((socket) => {
    const upstream = net.connect(targetPort, "127.0.0.1");
    socket.on("data", (buffer) => {
      chunks.push(Buffer.from(buffer));
      upstream.write(buffer);
    });
    upstream.on("data", (buffer) => socket.write(buffer));
    const stop = () => { socket.destroy(); upstream.destroy(); };
    socket.on("error", stop);
    upstream.on("error", stop);
    socket.on("end", () => upstream.end());
    upstream.on("end", () => socket.end());
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: server.address().port,
        bytes: () => Buffer.concat(chunks),
        clear: () => { chunks.length = 0; },
        close: () => server.close(),
      });
    });
  });
}

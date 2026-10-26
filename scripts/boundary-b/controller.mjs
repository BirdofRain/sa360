/**
 * Operator-side Boundary B controller.
 *
 * The process lives outside sa360-api and sa360-worker. Rollback state is a
 * mode 0600 spec file in the operator state directory. Production updates stay
 * disabled unless SA360_BOUNDARY_B_ALLOW_PRODUCTION=yes.
 */
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  closeSync,
  constants,
  existsSync,
  fchmodSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { specFingerprint } from "../app-spec-shape.mjs";
import { buildLoginUrl, changePasswordWithLibpq, generatePassword } from "./password-install.mjs";
import { runProbe } from "./probe.mjs";
import { redact } from "./redact.mjs";
import { canonicalJson, planDatabaseUrlOverrides } from "./spec-plan.mjs";

export const PRODUCTION_APP_ID = "2c381355-37a1-415f-bf06-ad477add164e";
export const ADMIN_APP_ID = "2075694a-ed30-4e7c-ae59-87b3ebfa9db7";
export const PINNED_SA360_FINGERPRINT = "e8b6df1dfbb82e9bcaa8dc9a5c783e9b3798ea33e7259578ade3458634a0b34f";

const PREVIEW_PASSWORD = "b2-preview-placeholder-value-not-installed";
const repoRootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function bare(code) {
  return {
    ok: false,
    code,
    recovery: null,
    deployment_id: null,
    changes: [],
    problems: [],
    rollback_attempts: 0,
    fallback_attempts: 0,
  };
}

function isInside(parent, child) {
  if (!parent) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function prepareStateDir(options) {
  const env = options.env ?? process.env;
  if (env.SA360_BOUNDARY_B_OPERATOR !== "operator") return { error: "operator_required" };
  if (env.DO_APP_NAME || env.SA360_APP_COMPONENT) return { error: "component_environment" };
  const stateDir = options.stateDir ?? (env.HOME ? path.join(env.HOME, ".sa360-boundary-b") : "");
  if (!stateDir) return { error: "state_dir_missing" };
  const repoRoot = options.repoRoot ?? repoRootDefault;
  const artifactsRoot = options.artifactsRoot ?? "/opt/cursor/artifacts";
  if (isInside(repoRoot, stateDir) || isInside(artifactsRoot, stateDir)) return { error: "state_dir_forbidden" };
  mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const created = lstatSync(stateDir);
  if (!created.isDirectory() || created.isSymbolicLink()) return { error: "state_dir_unsafe" };
  chmodSync(stateDir, 0o700);
  if ((lstatSync(stateDir).mode & 0o077) !== 0) return { error: "state_dir_unsafe" };
  return { env, stateDir };
}

function makeCtx(prepared, options) {
  return {
    env: prepared.env,
    stateDir: prepared.stateDir,
    apiBase: String(options.apiBase ?? prepared.env.SA360_BOUNDARY_B_API_BASE ?? "https://api.digitalocean.com").replace(/\/$/, ""),
    appId: options.appId ?? prepared.env.SA360_BOUNDARY_B_APP_ID ?? PRODUCTION_APP_ID,
    token: options.token ?? prepared.env.DIGITALOCEAN_ACCESS_TOKEN ?? "",
    fetchImpl: options.fetchImpl ?? globalThis.fetch,
    helperPath: options.helperPath ?? prepared.env.SA360_BOUNDARY_B_HELPER ?? path.join(prepared.stateDir, "pq-change-password"),
    maxPolls: options.maxPolls ?? 60,
    pollIntervalMs: options.pollIntervalMs ?? 5_000,
    expectedFingerprint: options.expectedFingerprint ?? null,
    installPassword: options.installPassword ?? null,
    probe: options.probe ?? null,
    secrets: [PREVIEW_PASSWORD],
    state: { rollbackAttempts: 0, fallbackAttempts: 0 },
    savedSpec: null,
  };
}

function guardApp(ctx) {
  if (ctx.appId === ADMIN_APP_ID) return "admin_app_forbidden";
  if (ctx.appId === PRODUCTION_APP_ID && ctx.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION !== "yes") return "production_disabled";
  return null;
}

function specPath(ctx) {
  return path.join(ctx.stateDir, "spec.json");
}

function statePath(ctx) {
  return path.join(ctx.stateDir, "state.json");
}

function reportPath(ctx) {
  return path.join(ctx.stateDir, "report.json");
}

function writeNew(file, text) {
  const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    writeSync(fd, text);
    fchmodSync(fd, 0o600);
  } finally {
    closeSync(fd);
  }
}

function replaceFile(file, text) {
  const temporary = `${file}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
  writeNew(temporary, text);
  try {
    renameSync(temporary, file);
  } catch (error) {
    unlinkSync(temporary);
    throw error;
  }
  chmodSync(file, 0o600);
}

function publicProblems(problems) {
  return problems.map((problem) => {
    const text = String(problem);
    if (text.includes("://") || text.includes("EV[") || /md5[0-9a-f]{32}/i.test(text)) return "redacted_problem";
    return text;
  });
}

function finish(ctx, code, extra = {}) {
  const report = {
    ok: code === "deployed" || code === "recovered" || code === "already_previous" || code === "preview",
    code,
    recovery: extra.recovery ?? null,
    deployment_id: extra.deploymentId ?? null,
    changes: extra.changes ?? [],
    problems: publicProblems(extra.problems ?? []),
    rollback_attempts: ctx.state?.rollbackAttempts ?? 0,
    fallback_attempts: ctx.state?.fallbackAttempts ?? 0,
  };
  replaceFile(reportPath(ctx), `${redact(JSON.stringify(report, null, 2), ctx.secrets)}\n`);
  return report;
}

function readApp(json) {
  const app = json?.app ?? json ?? {};
  return {
    spec: app.spec ?? null,
    active: app.active_deployment ?? null,
    inProgress: app.in_progress_deployment ?? null,
  };
}

function deploymentIdFrom(json) {
  return json?.deployment?.id ?? json?.app?.in_progress_deployment?.id ?? null;
}

async function request(ctx, method, requestPath, body) {
  let response;
  try {
    response = await ctx.fetchImpl(`${ctx.apiBase}${requestPath}`, {
      method,
      headers: {
        Authorization: `Bearer ${ctx.token}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    const error = new Error("http_lost");
    error.code = "http_lost";
    throw error;
  }
  const text = await response.text();
  let json = null;
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }
  if (response.status < 200 || response.status >= 300) {
    const error = new Error("http_status");
    error.code = "http_status";
    error.status = response.status;
    throw error;
  }
  return json ?? {};
}

function adminDatabaseUrl(spec) {
  const rows = (spec?.envs ?? []).filter((env) => env?.key === "DATABASE_URL");
  if (rows.length !== 1 || typeof rows[0].value !== "string") return null;
  return rows[0].value;
}

function rulesFor(ctx, adminUrl) {
  const production = ctx.appId === PRODUCTION_APP_ID;
  try {
    const parsed = new URL(adminUrl);
    return {
      adminUser: production ? "doadmin" : decodeURIComponent(parsed.username),
      production,
    };
  } catch {
    return { adminUser: production ? "doadmin" : "", production };
  }
}

function sameSpec(left, right) {
  return canonicalJson(left) === canonicalJson(right);
}

async function loadCurrent(ctx) {
  return readApp(await request(ctx, "GET", `/v2/apps/${ctx.appId}`));
}

function rememberSecrets(ctx, adminUrl) {
  try {
    const parsed = new URL(adminUrl);
    if (parsed.password) ctx.secrets.push(decodeURIComponent(parsed.password), parsed.password);
    ctx.secrets.push(adminUrl);
  } catch {
    ctx.secrets.push(adminUrl);
  }
}

async function inspect(ctx) {
  if (!ctx.token) return { error: bare("token_missing") };
  let current;
  try {
    current = await loadCurrent(ctx);
  } catch (error) {
    return { error: finish(ctx, error.status === 401 || error.status === 403 ? "read_not_authorized" : "read_failed") };
  }
  if (!current.spec) return { error: finish(ctx, "spec_missing") };
  const adminUrl = adminDatabaseUrl(current.spec);
  if (!adminUrl) return { error: finish(ctx, "spec_rejected", { problems: ["app_database_url_count"] }) };
  rememberSecrets(ctx, adminUrl);
  const fingerprint = specFingerprint(current.spec);
  if (ctx.appId === PRODUCTION_APP_ID && fingerprint !== PINNED_SA360_FINGERPRINT) {
    return { error: finish(ctx, "fingerprint_mismatch") };
  }
  if (ctx.expectedFingerprint && fingerprint !== ctx.expectedFingerprint) {
    return { error: finish(ctx, "fingerprint_mismatch") };
  }
  if (current.inProgress) return { error: finish(ctx, "deployment_in_progress") };
  if (!current.active?.id) return { error: finish(ctx, "active_deployment_missing") };
  const previewUrl = buildLoginUrl(adminUrl, "sa360_app", PREVIEW_PASSWORD);
  const preview = planDatabaseUrlOverrides(current.spec, previewUrl, rulesFor(ctx, adminUrl));
  return { current, adminUrl, fingerprint, preview };
}

function persistCaptured(ctx, spec, activeDeploymentId, fingerprint) {
  ctx.savedSpec = spec;
  ctx.state = {
    version: 1,
    appId: ctx.appId,
    activeDeploymentId,
    fingerprint,
    phase: "captured",
    rollbackAttempts: 0,
    fallbackAttempts: 0,
  };
  writeNew(specPath(ctx), `${JSON.stringify(spec, null, 2)}\n`);
  writeNew(statePath(ctx), `${JSON.stringify(ctx.state, null, 2)}\n`);
}

function loadSaved(ctx) {
  ctx.savedSpec = JSON.parse(readFileSync(specPath(ctx), "utf8"));
  ctx.state = JSON.parse(readFileSync(statePath(ctx), "utf8"));
  const adminUrl = adminDatabaseUrl(ctx.savedSpec);
  if (adminUrl) rememberSecrets(ctx, adminUrl);
}

function updateState(ctx, patch) {
  ctx.state = { ...ctx.state, ...patch };
  replaceFile(statePath(ctx), `${JSON.stringify(ctx.state, null, 2)}\n`);
}

async function pollDeployment(ctx, deploymentId) {
  for (let attempt = 0; attempt < ctx.maxPolls; attempt += 1) {
    let json;
    try {
      json = await request(ctx, "GET", `/v2/apps/${ctx.appId}/deployments/${deploymentId}`);
    } catch {
      return { outcome: "ambiguous" };
    }
    const deployment = json.deployment ?? json;
    const phase = deployment.phase ?? "";
    const result = deployment.result ?? "";
    if (phase === "ACTIVE" && result !== "FAILED" && result !== "ERROR" && result !== "CANCELED") {
      return { outcome: "active", deployment };
    }
    if (["ERROR", "CANCELED", "FAILED"].includes(phase) || ["FAILED", "ERROR", "CANCELED"].includes(result)) {
      return { outcome: "failed", deployment };
    }
    if (ctx.pollIntervalMs > 0) await new Promise((resolve) => setTimeout(resolve, ctx.pollIntervalMs));
  }
  return { outcome: "ambiguous" };
}

async function validateRollback(ctx, deploymentId) {
  try {
    const json = await request(ctx, "POST", `/v2/apps/${ctx.appId}/rollback/validate`, {
      deployment_id: deploymentId,
      skip_pin: true,
    });
    return json.valid === true ? "valid" : "invalid";
  } catch (error) {
    if (error.status === 401 || error.status === 403) return "unauthorized";
    return "lost";
  }
}

async function fallbackPut(ctx) {
  if (ctx.state.fallbackAttempts >= 1) return finish(ctx, "recovery_exhausted");
  updateState(ctx, { fallbackAttempts: ctx.state.fallbackAttempts + 1, phase: "fallback" });
  try {
    const json = await request(ctx, "PUT", `/v2/apps/${ctx.appId}`, {
      spec: ctx.savedSpec,
      update_all_source_versions: false,
    });
    const deploymentId = deploymentIdFrom(json);
    if (!deploymentId) return finish(ctx, "fallback_ambiguous");
    const polled = await pollDeployment(ctx, deploymentId);
    if (polled.outcome === "active") return finish(ctx, "recovered", { recovery: "saved_spec", deploymentId });
    return finish(ctx, "fallback_ambiguous");
  } catch (error) {
    if (error.status === 401 || error.status === 403) return finish(ctx, "recovery_not_authorized");
    try {
      const seen = await loadCurrent(ctx);
      if (sameSpec(seen.spec, ctx.savedSpec)) return finish(ctx, "recovered", { recovery: "saved_spec" });
    } catch {
      return finish(ctx, "fallback_ambiguous");
    }
    return finish(ctx, "fallback_ambiguous");
  }
}

async function recoverFromSaved(ctx) {
  if (ctx.state.rollbackAttempts >= 1 && ctx.state.fallbackAttempts >= 1) return finish(ctx, "recovery_exhausted");
  let current;
  try {
    current = await loadCurrent(ctx);
  } catch {
    return finish(ctx, "reconcile_unavailable");
  }
  if (sameSpec(current.spec, ctx.savedSpec) && !current.inProgress) return finish(ctx, "already_previous");
  if (current.inProgress && sameSpec(current.spec, ctx.savedSpec)) {
    const polled = await pollDeployment(ctx, current.inProgress.id);
    if (polled.outcome === "active") {
      return finish(ctx, "recovered", { recovery: "rollback", deploymentId: current.inProgress.id });
    }
    if (polled.outcome === "ambiguous") return finish(ctx, "rollback_ambiguous");
  }
  if (ctx.state.rollbackAttempts < 1) {
    const gate = await validateRollback(ctx, ctx.state.activeDeploymentId);
    if (gate === "unauthorized") return finish(ctx, "recovery_not_authorized");
    if (gate === "valid" || gate === "lost") {
      try {
        const json = await request(ctx, "POST", `/v2/apps/${ctx.appId}/rollback`, {
          deployment_id: ctx.state.activeDeploymentId,
          skip_pin: true,
        });
        updateState(ctx, { rollbackAttempts: 1, phase: "rollback" });
        const deploymentId = deploymentIdFrom(json);
        if (deploymentId) {
          const polled = await pollDeployment(ctx, deploymentId);
          if (polled.outcome === "active") return finish(ctx, "recovered", { recovery: "rollback", deploymentId });
          if (polled.outcome === "ambiguous") return finish(ctx, "rollback_ambiguous");
        }
      } catch (error) {
        updateState(ctx, { rollbackAttempts: 1, phase: "rollback_lost" });
        if (error.status === 401 || error.status === 403) return finish(ctx, "recovery_not_authorized");
        try {
          const seen = await loadCurrent(ctx);
          if (sameSpec(seen.spec, ctx.savedSpec)) {
            if (!seen.inProgress) return finish(ctx, "already_previous");
            const polled = await pollDeployment(ctx, seen.inProgress.id);
            if (polled.outcome === "active") {
              return finish(ctx, "recovered", { recovery: "rollback", deploymentId: seen.inProgress.id });
            }
            return finish(ctx, "rollback_ambiguous");
          }
        } catch {
          return finish(ctx, "rollback_ambiguous");
        }
      }
    } else {
      updateState(ctx, { rollbackAttempts: 1, phase: "rollback_invalid" });
    }
  }
  return fallbackPut(ctx);
}

async function defaultInstall(ctx, adminUrl) {
  if (!existsSync(ctx.helperPath)) return { ok: false, code: "password_not_changed" };
  const password = generatePassword();
  let admin;
  try {
    admin = new URL(adminUrl);
  } catch {
    return { ok: false, code: "password_not_changed" };
  }
  try {
    const result = await changePasswordWithLibpq({
      helperPath: ctx.helperPath,
      role: "sa360_app",
      password,
      host: admin.hostname,
      port: admin.port || "5432",
      adminUser: decodeURIComponent(admin.username),
      adminPassword: decodeURIComponent(admin.password),
      database: decodeURIComponent(admin.pathname.replace(/^\//, "")),
      sslmode: admin.searchParams.get("sslmode") || "require",
    });
    if (!result.ok) return result;
    return { ok: true, password, url: buildLoginUrl(adminUrl, "sa360_app", password) };
  } catch {
    return { ok: false, code: "password_not_changed" };
  }
}

async function reconcileLostPut(ctx, proposed) {
  let current;
  try {
    current = await loadCurrent(ctx);
  } catch {
    return finish(ctx, "reconcile_unavailable");
  }
  if (sameSpec(current.spec, ctx.savedSpec)) return finish(ctx, "spec_unchanged");
  if (sameSpec(current.spec, proposed)) {
    const deploymentId = current.inProgress?.id ?? current.active?.id ?? null;
    if (!deploymentId) return finish(ctx, "deployment_ambiguous");
    const polled = await pollDeployment(ctx, deploymentId);
    if (polled.outcome === "active") return finish(ctx, "deployed", { deploymentId });
    if (polled.outcome === "failed") return recoverFromSaved(ctx);
    return finish(ctx, "deployment_ambiguous");
  }
  return finish(ctx, "spec_unrecognized");
}

async function putProposed(ctx, proposed) {
  updateState(ctx, { phase: "put_attempted" });
  try {
    const json = await request(ctx, "PUT", `/v2/apps/${ctx.appId}`, {
      spec: proposed,
      update_all_source_versions: false,
    });
    const deploymentId = deploymentIdFrom(json);
    if (!deploymentId) return reconcileLostPut(ctx, proposed);
    const polled = await pollDeployment(ctx, deploymentId);
    if (polled.outcome === "active") return finish(ctx, "deployed", { deploymentId, changes: ctx.changes });
    if (polled.outcome === "failed") return recoverFromSaved(ctx);
    return finish(ctx, "deployment_ambiguous", { deploymentId });
  } catch (error) {
    if (error.status === 401 || error.status === 403) {
      try {
        const seen = await loadCurrent(ctx);
        if (sameSpec(seen.spec, ctx.savedSpec)) return finish(ctx, "put_rejected");
      } catch {
        return finish(ctx, "reconcile_unavailable");
      }
      return finish(ctx, "spec_unrecognized");
    }
    return reconcileLostPut(ctx, proposed);
  }
}

export async function previewCutover(options = {}) {
  const prepared = prepareStateDir(options);
  if (prepared.error) return bare(prepared.error);
  const ctx = makeCtx(prepared, options);
  const guard = guardApp(ctx);
  if (guard) return bare(guard);
  const inspected = await inspect(ctx);
  if (inspected.error) return inspected.error;
  if (!inspected.preview.ok) return finish(ctx, "spec_rejected", { problems: inspected.preview.problems });
  if (options.persist) {
    if (existsSync(specPath(ctx))) return finish(ctx, "state_exists");
    persistCaptured(ctx, inspected.current.spec, inspected.current.active.id, inspected.fingerprint);
  }
  return finish(ctx, "preview", { changes: inspected.preview.changes });
}

export async function executeCutover(options = {}) {
  const prepared = prepareStateDir(options);
  if (prepared.error) return bare(prepared.error);
  const ctx = makeCtx(prepared, options);
  const guard = guardApp(ctx);
  if (guard) return bare(guard);
  if (existsSync(specPath(ctx))) return finish(ctx, "state_exists");
  const inspected = await inspect(ctx);
  if (inspected.error) return inspected.error;
  if (!inspected.preview.ok) return finish(ctx, "spec_rejected", { problems: inspected.preview.problems });
  const gate = await validateRollback(ctx, inspected.current.active.id);
  if (gate === "unauthorized") return finish(ctx, "update_not_authorized");
  if (gate === "invalid") return finish(ctx, "rollback_target_invalid");
  if (gate !== "valid") return finish(ctx, "validate_lost");
  persistCaptured(ctx, inspected.current.spec, inspected.current.active.id, inspected.fingerprint);
  const installed = ctx.installPassword
    ? await ctx.installPassword({ adminUrl: inspected.adminUrl })
    : await defaultInstall(ctx, inspected.adminUrl);
  if (installed?.password) ctx.secrets.push(installed.password);
  if (installed?.url) ctx.secrets.push(installed.url);
  if (!installed?.ok) return finish(ctx, installed?.code || "password_install_failed");
  const probe = ctx.probe ?? (ctx.appId === PRODUCTION_APP_ID ? (url) => runProbe(url) : null);
  if (!probe) return finish(ctx, "probe_required");
  const probed = await probe(installed.url);
  if (!probed?.ok) return finish(ctx, "probe_failed");
  const proposed = planDatabaseUrlOverrides(inspected.current.spec, installed.url, rulesFor(ctx, inspected.adminUrl));
  if (!proposed.ok) return finish(ctx, "spec_rejected", { problems: proposed.problems });
  ctx.changes = proposed.changes;
  return putProposed(ctx, proposed.next);
}

export async function recoverCutover(options = {}) {
  const prepared = prepareStateDir(options);
  if (prepared.error) return bare(prepared.error);
  const ctx = makeCtx(prepared, options);
  const guard = guardApp(ctx);
  if (guard) return bare(guard);
  if (!existsSync(specPath(ctx)) || !existsSync(statePath(ctx))) return bare("state_missing");
  if (!ctx.token) return bare("token_missing");
  loadSaved(ctx);
  return recoverFromSaved(ctx);
}

async function main() {
  const command = process.argv[2];
  if (!["preview", "execute", "recover"].includes(command)) {
    process.stderr.write("usage: controller.mjs preview|execute|recover\n");
    process.exitCode = 2;
    return;
  }
  const runner = command === "preview" ? previewCutover : command === "execute" ? executeCutover : recoverCutover;
  try {
    const result = await runner({});
    process.stdout.write(`${redact(JSON.stringify(result), [process.env.DIGITALOCEAN_ACCESS_TOKEN].filter(Boolean))}\n`);
    process.exitCode = result.ok ? 0 : 2;
  } catch {
    process.stderr.write("controller_failed\n");
    process.exitCode = 2;
  }
}

if (process.argv[1] && process.argv[1].endsWith(`${path.sep}controller.mjs`)) {
  main();
}

import { spawn } from "node:child_process";

import { operatorVerifyFull, productionAdminUrlAccepted } from "./password-install.mjs";

const FAILURES = [
  "migrate_completed",
  "migrate_identity",
  "api_identity",
  "worker_identity",
  "api_health",
  "database_health",
  "queue_health",
  "admin_health",
  "restricted_grants",
  "summary_inactive",
  "projection_ready",
  "sheets_path",
  "intake_path",
  "onboarding_path",
];

export function migrateBinding(spec) {
  const app = (spec?.envs ?? []).find((item) => item?.key === "DATABASE_URL");
  let appUser = null;
  try {
    appUser = decodeURIComponent(new URL(app.value).username);
  } catch {
    appUser = null;
  }
  const job = (spec?.jobs ?? []).find((item) => item?.name === "sa360-migrate");
  const migrateOverride = (job?.envs ?? []).some((item) => item?.key === "DATABASE_URL");
  return { appUser, migrateOverride };
}

export function passingPostActiveEvidence() {
  return {
    migrate: { completed: true, identity: "doadmin", identity_source: "catalog_read" },
    api: {
      source: "component_console",
      user: "sa360_app",
      database: "defaultdb",
      port: 25060,
      ssl: true,
      grants_ok: true,
      summary_functions: 0,
      summary_triggers: 0,
      projection: { ready: true, counts_match: true, triggers_enabled: 3 },
      paths: { sheets: true, intake: true, onboarding: true },
    },
    worker: {
      source: "component_console",
      user: "sa360_app",
      database: "defaultdb",
      port: 25060,
      ssl: true,
      grants_ok: true,
      summary_functions: 0,
      summary_triggers: 0,
    },
    health: { api: true, database: true, queue: true, admin: true },
    summary: { ready: false, functions: 0 },
  };
}

export function migrateEvidenceFromLog(logText, binding = {}) {
  const text = String(logText ?? "");
  const denied = /permission denied/i.test(text);
  const applied = /Applying migration|successfully applied/i.test(text);
  const completed = !denied && !applied && /No pending migrations to apply\./.test(text);
  const identity = completed && binding.appUser === "doadmin" && binding.migrateOverride !== true ? "doadmin" : null;
  return {
    completed,
    identity,
    identity_source: identity === "doadmin" ? "catalog_read" : null,
  };
}

export function parseComponentReport(text) {
  const marker = `COMPONENT_${"REPORT"} `;
  const lines = String(text ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "").split(/\n/);
  const line = [...lines].reverse().find((item) => item.startsWith(marker));
  if (!line) return null;
  let parsed;
  try {
    parsed = JSON.parse(line.slice(marker.length));
  } catch {
    return null;
  }
  if (parsed?.user !== "sa360_app" && parsed?.user !== "doadmin") return { source: "component_console", user: null };
  return {
    source: "component_console",
    user: parsed.user,
    database: parsed.database ?? null,
    port: parsed.port ?? null,
    ssl: parsed.ssl === true,
    grants_ok: parsed.grants_ok === true,
    projection: parsed.projection ?? null,
    paths: parsed.paths ?? null,
    summary_functions: parsed.summary_functions ?? null,
    summary_triggers: parsed.summary_triggers ?? null,
  };
}

export function parseSummaryRow(text) {
  const line = String(text ?? "")
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "")
    .split(/\n/)
    .map((item) => item.trim())
    .filter((item) => item && !item.startsWith("SET") && item !== "f" && !item.startsWith("("))
    .at(-1);
  if (!line || !/^[tf]\|\d+$/.test(line)) return null;
  const [ready, functions] = line.split("|");
  return { ready: ready === "t", functions: Number(functions) };
}

export function evaluatePostActive(evidence) {
  const value = evidence ?? {};
  const migrate = value.migrate ?? {};
  const api = value.api ?? {};
  const worker = value.worker ?? {};
  const health = value.health ?? {};
  const summary = value.summary ?? {};
  const projection = api.projection ?? {};
  const paths = api.paths ?? {};
  const checks = {
    migrate_completed: migrate.completed === true,
    migrate_identity: migrate.identity === "doadmin" && migrate.identity_source === "catalog_read",
    api_identity: api.source === "component_console" && api.user === "sa360_app" && api.database === "defaultdb" && api.port === 25060 && api.ssl === true,
    worker_identity: worker.source === "component_console" && worker.user === "sa360_app" && worker.database === "defaultdb" && worker.port === 25060 && worker.ssl === true,
    api_health: health.api === true,
    database_health: health.database === true,
    queue_health: health.queue === true,
    admin_health: health.admin === true,
    restricted_grants: api.grants_ok === true && worker.grants_ok === true,
    summary_inactive: summary.ready === false && summary.functions === 0 && api.summary_functions === 0 && api.summary_triggers === 0 && worker.summary_functions === 0 && worker.summary_triggers === 0,
    projection_ready: projection.ready === true && projection.counts_match === true && projection.triggers_enabled === 3,
    sheets_path: paths.sheets === true,
    intake_path: paths.intake === true,
    onboarding_path: paths.onboarding === true,
  };
  const failures = FAILURES.filter((name) => checks[name] !== true);
  return { ok: failures.length === 0, failures };
}

export function consoleCommands(script) {
  const encoded = Buffer.from(script, "utf8").toString("base64");
  const commands = ["rm -f /tmp/sa360-post-active.b64 /tmp/sa360-post-active.mjs"];
  for (let index = 0; index < encoded.length; index += 180) {
    commands.push(`printf '%s' '${encoded.slice(index, index + 180)}' >> /tmp/sa360-post-active.b64`);
  }
  commands.push("base64 -d /tmp/sa360-post-active.b64 > /tmp/sa360-post-active.mjs && node /tmp/sa360-post-active.mjs; status=$?; rm -f /tmp/sa360-post-active.b64 /tmp/sa360-post-active.mjs; exit $status");
  return commands;
}

export const componentScript = `
import { createRequire } from "node:module";
const require = createRequire("/workspace/apps/api/package.json");
const { PrismaClient } = require("@prisma/client");
const prisma = new PrismaClient();
const marker = "COMPONENT_" + "REPORT ";
try {
  const rows = await prisma.$queryRawUnsafe(\`
    SELECT current_user AS "user",
      current_database() AS database,
      inet_server_port() AS port,
      s.ssl AS ssl,
      (
        has_table_privilege(current_user, 'public."SourceLeadEvent"', 'INSERT')
        AND NOT has_table_privilege(current_user, 'public."_prisma_migrations"', 'SELECT')
        AND NOT has_table_privilege(current_user, 'public.historical_catalog_summary_control', 'UPDATE')
        AND NOT has_column_privilege(current_user, 'public.historical_catalog_projection_control', 'ready', 'UPDATE')
        AND NOT has_schema_privilege(current_user, 'public', 'CREATE')
        AND NOT has_schema_privilege(current_user, 'sa360_summary', 'USAGE')
        AND NOT has_table_privilege(current_user, 'public."ClientOnboardingTestAttemptKey"', 'UPDATE')
        AND NOT has_table_privilege(current_user, 'public."ClientOnboardingV2AuditEvent"', 'DELETE')
      ) AS grants_ok,
      has_table_privilege(current_user, 'public."SourceLeadEvent"', 'INSERT') AS intake,
      has_table_privilege(current_user, 'public."CompanySheetsDispatchIntent"', 'INSERT') AS sheets,
      has_table_privilege(current_user, 'public."ClientOnboardingDestinationProfile"', 'INSERT') AS onboarding,
      (SELECT count(*) FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'historical_catalog_summary_%') AS summary_functions,
      (SELECT count(*) FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = 'public' AND NOT t.tgisinternal AND t.tgname LIKE 'historical_catalog_summary_%') AS summary_triggers
    FROM pg_stat_ssl s
    WHERE s.pid = pg_backend_pid()
  \`);
  const projection = await prisma.$queryRawUnsafe(\`
    SELECT ready,
      source_row_count = projection_row_count AS counts_match,
      (SELECT count(*) FROM pg_trigger WHERE NOT tgisinternal AND tgname IN ('historical_catalog_projection_item_refresh', 'historical_catalog_projection_event_refresh', 'historical_catalog_projection_lot_refresh') AND tgenabled = 'O') AS triggers_enabled
    FROM historical_catalog_projection_control
  \`);
  const row = rows[0];
  const control = projection[0];
  process.stdout.write(marker + JSON.stringify({
    user: row.user,
    database: row.database,
    port: Number(row.port),
    ssl: row.ssl === true,
    grants_ok: row.grants_ok === true,
    summary_functions: Number(row.summary_functions),
    summary_triggers: Number(row.summary_triggers),
    projection: {
      ready: control.ready === true,
      counts_match: control.counts_match === true,
      triggers_enabled: Number(control.triggers_enabled),
    },
    paths: { intake: row.intake === true, sheets: row.sheets === true, onboarding: row.onboarding === true },
  }) + "\\n");
} finally {
  await prisma.$disconnect();
}
`;

export function framesFor(commands) {
  return commands.map((command) => JSON.stringify({ op: "stdin", data: `${command}\n` }));
}

export async function readPublicHealth(fetchImpl, targets) {
  async function read(url) {
    const response = await fetchImpl(url);
    const body = await response.json();
    return { status: response.status, body };
  }
  const [health, database, queue, admin] = await Promise.all([
    read(`${targets.apiBase}/health`),
    read(`${targets.apiBase}/health/db`),
    read(`${targets.apiBase}/health/queue`),
    read(targets.adminHealth),
  ]);
  return {
    api: health.status === 200 && health.body?.ok === true && health.body?.service === "api",
    database: database.status === 200 && database.body?.ok === true && database.body?.db === "connected",
    queue: queue.status === 200 && queue.body?.ok === true && queue.body?.queue === "PONG",
    admin: admin.status === 200 && admin.body?.ok === true && admin.body?.service === "admin-coc",
  };
}

function runPsql(url, verified, sql) {
  const parsed = new URL(url);
  const env = {
    ...process.env,
    PGHOST: parsed.hostname,
    PGPORT: parsed.port || "5432",
    PGDATABASE: parsed.pathname.replace(/^\//, ""),
    PGUSER: decodeURIComponent(parsed.username),
    PGPASSWORD: decodeURIComponent(parsed.password),
    PGSSLMODE: "verify-full",
    PGGSSENCMODE: "disable",
    PGSSLROOTCERT: verified.caPath,
  };
  return new Promise((resolve) => {
    const child = spawn("psql", ["-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-c", sql], { env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (status) => resolve({ status, stdout, stderr }));
  });
}

export async function readSummaryControl(adminUrl, options = {}) {
  const accepted = productionAdminUrlAccepted(adminUrl);
  if (!accepted.ok) return { ok: false, code: accepted.code };
  const verified = operatorVerifyFull({
    host: accepted.host,
    port: accepted.port,
    user: accepted.user,
    database: accepted.database,
    rootCert: options.rootCert,
    repoRoot: options.repoRoot,
    artifactsRoot: options.artifactsRoot,
  });
  if (!verified.ok) return verified;
  const result = await runPsql(
    adminUrl,
    verified,
    "SELECT summary_ready::text || '|' || (SELECT count(*)::text FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname LIKE 'historical_catalog_summary_%') FROM historical_catalog_summary_control",
  );
  if (result.status !== 0) return { ok: false, code: "summary_read_failed" };
  const parsed = parseSummaryRow(result.stdout);
  if (!parsed) return { ok: false, code: "summary_read_failed" };
  return { ok: true, ready: parsed.ready, functions: parsed.functions };
}

export function healthTargets(env) {
  const apiBase = env.SA360_PROD_API_URL ?? "";
  const adminHealth = env.SA360_BOUNDARY_B_ADMIN_HEALTH_URL ?? "";
  if (!apiBase || !adminHealth) return { ok: false, code: "post_active_unconfigured" };
  return { ok: true, apiBase: apiBase.replace(/\/$/, ""), adminHealth };
}

export function completeComponentLine(output) {
  const marker = `COMPONENT_${"REPORT"} `;
  const cleaned = String(output ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").replace(/\r/g, "");
  const index = cleaned.lastIndexOf(marker);
  if (index < 0) return null;
  const rest = cleaned.slice(index + marker.length);
  const newline = rest.indexOf("\n");
  const candidate = (newline === -1 ? rest : rest.slice(0, newline)).trim();
  try {
    JSON.parse(candidate);
  } catch {
    return null;
  }
  return `${marker}${candidate}`;
}

function frameData(payload) {
  const text = typeof payload === "string" ? payload : "";
  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.data === "string") return parsed.data;
  } catch {
    return text;
  }
  return text;
}

export async function openConsole(url, commands, WebSocketImpl = globalThis.WebSocket) {
  const socket = new WebSocketImpl(url);
  let output = "";
  let settled = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.close();
      reject(Object.assign(new Error("console_timeout"), { code: "console_timeout" }));
    }, 20000);
    socket.addEventListener("open", () => {
      for (const frame of framesFor(commands)) socket.send(frame);
    });
    socket.addEventListener("message", (event) => {
      output += frameData(event.data);
      if (!settled && completeComponentLine(output)) {
        settled = true;
        clearTimeout(timer);
        socket.close();
        resolve(output);
      }
    });
    socket.addEventListener("error", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error("console_unavailable"), { code: "console_unavailable" }));
    });
    socket.addEventListener("close", () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(Object.assign(new Error("console_closed"), { code: "console_closed" }));
    });
  });
  return output;
}

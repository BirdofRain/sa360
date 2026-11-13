import { spawn } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { escapePgpass, operatorDisposableLoopback, operatorVerifyFull, productionAdminUrlAccepted } from "./password-install.mjs";

export const productionProbeChecks = [
  {
    name: "identity",
    sql: "SELECT current_user || '|' || current_database() || '|' || inet_server_port()::text || '|' || COALESCE((SELECT ssl::text FROM pg_stat_ssl WHERE pid = pg_backend_pid()), 'off')",
    expect: "text",
    accept: ["sa360_app|defaultdb|25060|true", "sa360_app|defaultdb|25060|t"],
  },
  {
    name: "lead_inventory",
    sql: 'SELECT count(*) FROM "LeadInventoryItem"',
    expect: "ok",
  },
  {
    name: "projection_ready",
    sql: "SELECT ready FROM historical_catalog_projection_control",
    expect: "text",
    accept: ["t", "true"],
  },
  {
    name: "ownership_decision",
    sql: "SELECT decision FROM historical_campaign_ownership_decision(NULL, NULL, NULL)",
    expect: "ok",
  },
  {
    name: "migrations_denied",
    sql: "SELECT count(*) FROM _prisma_migrations",
    expect: "denied",
  },
  {
    name: "summary_denied",
    sql: "BEGIN; UPDATE historical_catalog_summary_control SET summary_ready = summary_ready; ROLLBACK;",
    expect: "denied",
  },
  {
    name: "projection_update_denied",
    sql: "BEGIN; UPDATE historical_catalog_projection_control SET ready = ready; ROLLBACK;",
    expect: "denied",
  },
  {
    name: "backfill_denied",
    sql: "SELECT has_function_privilege(current_user, 'public.historical_catalog_projection_backfill_chunk(text, text)', 'EXECUTE')",
    expect: "text",
    accept: ["f", "false"],
  },
];

function runPsql(env, sql, conninfo) {
  const args = ["-X", "-q", "-t", "-A", "-v", "ON_ERROR_STOP=1"];
  if (conninfo) args.push("-d", conninfo);
  args.push("-f", "-");
  return new Promise((resolve, reject) => {
    const child = spawn("psql", args, {
      env,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("error", reject);
    child.once("exit", (code) => resolve({ code, stdout, stderr }));
    child.stdin.write(sql.endsWith("\n") ? sql : `${sql}\n`);
    child.stdin.end();
  });
}

function checkPassed(check, result) {
  const text = result.stdout.trim();
  if (check.expect === "ok") return result.code === 0;
  if (check.expect === "denied") {
    return result.code !== 0 && /permission denied/i.test(`${result.stdout}\n${result.stderr}`);
  }
  return result.code === 0 && check.accept.includes(text);
}

export async function runProbe(databaseUrl, checks = productionProbeChecks, options = {}) {
  const parsed = new URL(databaseUrl);
  const host = options.host ?? parsed.hostname;
  const database = decodeURIComponent(parsed.pathname.replace(/^\//, ""));
  const user = decodeURIComponent(parsed.username);
  let verified = null;
  if (options.disposableLoopback) {
    verified = operatorDisposableLoopback({ host, port: parsed.port, user, database });
    if (!verified.ok) return { ok: false, code: verified.code, results: [] };
  } else {
    const accepted = productionAdminUrlAccepted(databaseUrl);
    if (!accepted.ok) return { ok: false, code: accepted.code, results: [] };
    verified = operatorVerifyFull({
      host,
      port: parsed.port,
      user,
      database,
      rootCert: options.rootCert,
      hostaddr: options.hostaddr,
      repoRoot: options.repoRoot,
      artifactsRoot: options.artifactsRoot,
    });
    if (!verified.ok) return { ok: false, code: verified.code, results: [] };
  }
  const directory = mkdtempSync(join(tmpdir(), "sa360-b2-probe-"));
  chmodSync(directory, 0o700);
  const home = join(directory, "home");
  const pgpass = join(directory, "pgpass");
  mkdirSync(home, { recursive: true, mode: 0o700 });
  chmodSync(home, 0o700);
  const line = [
    escapePgpass(host),
    parsed.port,
    escapePgpass(database),
    escapePgpass(user),
    escapePgpass(decodeURIComponent(parsed.password)),
  ].join(":");
  writeFileSync(pgpass, `${line}\n`, { mode: 0o600 });
  chmodSync(pgpass, 0o600);
  const env = {
    PATH: process.env.PATH,
    HOME: home,
    PSQLRC: "/dev/null",
    PGHOST: host,
    PGPORT: parsed.port,
    PGUSER: user,
    PGDATABASE: database,
    PGPASSFILE: pgpass,
    ...verified.env,
    PGCONNECT_TIMEOUT: "10",
  };
  const results = [];
  try {
    for (const check of checks) {
      const result = await runPsql(env, check.sql, verified ? verified.conninfo : "");
      results.push({ name: check.name, ok: checkPassed(check, result) });
    }
  } finally {
    writeFileSync(pgpass, Buffer.alloc(4096));
    rmSync(directory, { recursive: true, force: true });
  }
  return { ok: results.every((result) => result.ok), results };
}

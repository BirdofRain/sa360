import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";

export function generatePassword() {
  return randomBytes(32).toString("base64url");
}

export function escapePgpass(value) {
  return String(value).replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

export function buildLoginUrl(adminUrl, user, password) {
  const url = new URL(adminUrl);
  url.username = user;
  url.password = password;
  return url.toString();
}

function conninfoToken(value) {
  const text = String(value);
  if (!text || /[\s"'\\]/.test(text)) {
    throw Object.assign(new Error("tls_conninfo_rejected"), { code: "tls_conninfo_rejected" });
  }
  return text;
}

export function operatorVerifyFull({ host, port, user, database, rootCert, hostaddr }) {
  if (!rootCert || !existsSync(rootCert)) return { ok: false, code: "tls_root_cert_missing" };
  const resolved = path.resolve(rootCert);
  try {
    const parts = [
      `host=${conninfoToken(host)}`,
      `port=${conninfoToken(port)}`,
      `user=${conninfoToken(user)}`,
      `dbname=${conninfoToken(database)}`,
      "sslmode=verify-full",
      `sslrootcert=${conninfoToken(resolved)}`,
    ];
    if (hostaddr) parts.push(`hostaddr=${conninfoToken(hostaddr)}`);
    const conninfo = parts.join(" ");
    return {
      ok: true,
      conninfo,
      rootCert: resolved,
      env: {
        PGHOST: String(host),
        PGPORT: String(port),
        PGUSER: String(user),
        PGDATABASE: String(database),
        PGSSLMODE: "verify-full",
        PGSSLROOTCERT: resolved,
        SA360_BOUNDARY_B_TLS: "verify-full",
        ...(hostaddr ? { PGHOSTADDR: String(hostaddr) } : {}),
      },
    };
  } catch (error) {
    return { ok: false, code: error.code || "tls_conninfo_rejected" };
  }
}

function pgpassField(value) {
  return escapePgpass(value);
}

async function waitForFile(path, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      accessSync(path, constants.R_OK);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  throw Object.assign(new Error("password_helper_hold_expired"), { code: "password_helper_hold_expired" });
}

export async function changePasswordWithLibpq({
  helperPath,
  role,
  password,
  host,
  port,
  adminUser,
  adminPassword,
  database,
  sslmode,
  rootCert,
  hostaddr,
  hold,
}) {
  let verified = null;
  if (sslmode !== "disable") {
    verified = operatorVerifyFull({ host, port: String(port), user: adminUser, database, rootCert, hostaddr });
    if (!verified.ok) return verified;
  }
  const directory = mkdtempSync(join(tmpdir(), "sa360-b2-"));
  chmodSync(directory, 0o700);
  const pgpass = join(directory, "pgpass");
  const line = [
    pgpassField(host),
    String(port),
    pgpassField(database),
    pgpassField(adminUser),
    pgpassField(adminPassword),
  ].join(":");
  writeFileSync(pgpass, `${line}\n`, { mode: 0o600 });
  chmodSync(pgpass, 0o600);
  const env = {
    SA360_PASSWORD_ROLE: role,
    PGHOST: host,
    PGPORT: String(port),
    PGUSER: adminUser,
    PGDATABASE: database,
    PGSSLMODE: verified ? "verify-full" : "disable",
    PGPASSFILE: pgpass,
    PGCONNECT_TIMEOUT: "10",
    ...(verified ? verified.env : {}),
  };
  if (hold?.readyFile) {
    env.SA360_PQ_READY_FILE = hold.readyFile;
    env.SA360_PQ_RELEASE_FILE = hold.releaseFile;
  }
  let stdout = "";
  let stderr = "";
  const child = spawn(helperPath, [], { env, stdio: ["pipe", "pipe", "pipe"] });
  child.stdin.on("error", () => {});
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });
  let settled = false;
  const exited = new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", (code) => resolve(code));
  });
  try {
    if (hold?.readyFile) {
      await waitForFile(hold.readyFile, hold.timeoutMs ?? 5_000);
      if (hold.onReady) await hold.onReady(child.pid);
      writeFileSync(hold.releaseFile, "go\n", { mode: 0o600 });
    }
    child.stdin.write(`${password}\n`);
    child.stdin.end();
    const code = await exited;
    settled = true;
    const leaked = stdout.includes(password) || stderr.includes(password) || stderr.includes(adminPassword);
    if (leaked) return { ok: false, code: "password_install_leaked" };
    if (code === 0 && stdout === "ok\n") return { ok: true, code: "password_installed" };
    if (stdout === "refused\n" || code === 2 || code === 3) return { ok: false, code: "password_not_changed" };
    return { ok: false, code: "password_install_failed" };
  } finally {
    if (!settled) {
      child.kill("SIGKILL");
      await exited.catch(() => {});
    }
    writeFileSync(pgpass, Buffer.alloc(4096));
    rmSync(directory, { recursive: true, force: true });
  }
}

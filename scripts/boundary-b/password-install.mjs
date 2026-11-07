import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { accessSync, chmodSync, constants, lstatSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path, { join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRootDefault = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const artifactsRootDefault = "/opt/cursor/artifacts";

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

function currentUid() {
  return typeof process.getuid === "function" ? process.getuid() : null;
}

function isInside(parent, child) {
  if (!parent) return false;
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function caFailure(code) {
  return { ok: false, code };
}

function parentIsUnsafe(stat, uid) {
  const writable = (stat.mode & 0o022) !== 0;
  const stickyRoot = (stat.mode & 0o1000) !== 0 && stat.uid === 0;
  if (writable && !stickyRoot) return true;
  return stat.uid !== 0 && stat.uid !== uid;
}

export function validateOperatorCa(rootCert, options = {}) {
  if (!rootCert || typeof rootCert !== "string") return caFailure("tls_root_cert_missing");
  const uid = currentUid();
  if (uid === null) return caFailure("tls_root_cert_unsafe");
  const resolved = path.resolve(rootCert);
  const repoRoot = options.repoRoot ?? repoRootDefault;
  const artifactsRoot = options.artifactsRoot ?? artifactsRootDefault;
  if (isInside(repoRoot, resolved) || isInside(artifactsRoot, resolved)) return caFailure("tls_root_cert_forbidden");
  let stat;
  try {
    stat = lstatSync(resolved);
  } catch (error) {
    return caFailure(error?.code === "ENOENT" ? "tls_root_cert_missing" : "tls_root_cert_unsafe");
  }
  if (stat.isSymbolicLink() || !stat.isFile()) return caFailure("tls_root_cert_unsafe");
  if (stat.uid !== uid || (stat.mode & 0o077) !== 0) return caFailure("tls_root_cert_unsafe");
  try {
    accessSync(resolved, constants.R_OK);
  } catch {
    return caFailure("tls_root_cert_unsafe");
  }
  const root = path.parse(resolved).root;
  let current = path.dirname(resolved);
  const seen = new Set();
  while (!seen.has(current)) {
    seen.add(current);
    let parent;
    try {
      parent = lstatSync(current);
    } catch {
      return caFailure("tls_root_cert_unsafe");
    }
    if (parent.isSymbolicLink() || !parent.isDirectory() || parentIsUnsafe(parent, uid)) return caFailure("tls_root_cert_unsafe");
    if (current === root) break;
    const next = path.dirname(current);
    if (next === current) return caFailure("tls_root_cert_unsafe");
    current = next;
  }
  try {
    if (realpathSync(resolved) !== resolved) return caFailure("tls_root_cert_unsafe");
  } catch {
    return caFailure("tls_root_cert_unsafe");
  }
  return { ok: true, rootCert: resolved };
}

export function operatorConnectionPolicy(conninfo) {
  const text = String(conninfo ?? "");
  if (/(?:^|\s)sslmode=(?:disable|allow|prefer|require)(?:\s|$)/.test(text)) return { ok: false, code: "operator_tls_weakened" };
  if (/(?:^|\s)gssencmode=(?:prefer|require)(?:\s|$)/.test(text)) return { ok: false, code: "operator_tls_weakened" };
  if (!/(?:^|\s)sslmode=verify-full(?:\s|$)/.test(text)) return { ok: false, code: "operator_tls_required" };
  if (!/(?:^|\s)gssencmode=disable(?:\s|$)/.test(text)) return { ok: false, code: "operator_tls_required" };
  if (!/(?:^|\s)sslrootcert=\S+/.test(text)) return { ok: false, code: "tls_root_cert_missing" };
  return { ok: true };
}

export function productionAdminUrlAccepted(adminUrl) {
  let admin;
  try {
    admin = new URL(adminUrl);
  } catch {
    return { ok: false, code: "operator_tls_required" };
  }
  if (admin.protocol !== "postgresql:" && admin.protocol !== "postgres:") return { ok: false, code: "operator_tls_required" };
  if (admin.searchParams.get("sslmode") !== "require") return { ok: false, code: "operator_tls_required" };
  for (const key of admin.searchParams.keys()) {
    if (key !== "sslmode") return { ok: false, code: "operator_tls_weakened" };
  }
  const database = decodeURIComponent(admin.pathname.replace(/^\//, ""));
  if (!admin.hostname || !admin.port || !admin.username || !admin.password || !database) {
    return { ok: false, code: "operator_tls_required" };
  }
  return {
    ok: true,
    host: admin.hostname,
    port: admin.port,
    user: decodeURIComponent(admin.username),
    password: decodeURIComponent(admin.password),
    database,
  };
}

export function operatorVerifyFull({ host, port, user, database, rootCert, hostaddr, repoRoot, artifactsRoot }) {
  const ca = validateOperatorCa(rootCert, { repoRoot, artifactsRoot });
  if (!ca.ok) return ca;
  try {
    const parts = [
      `host=${conninfoToken(host)}`,
      `port=${conninfoToken(port)}`,
      `user=${conninfoToken(user)}`,
      `dbname=${conninfoToken(database)}`,
      "sslmode=verify-full",
      "gssencmode=disable",
      `sslrootcert=${conninfoToken(ca.rootCert)}`,
    ];
    if (hostaddr) parts.push(`hostaddr=${conninfoToken(hostaddr)}`);
    const conninfo = parts.join(" ");
    const policy = operatorConnectionPolicy(conninfo);
    if (!policy.ok) return policy;
    return {
      ok: true,
      conninfo,
      rootCert: ca.rootCert,
      env: {
        PGHOST: String(host),
        PGPORT: String(port),
        PGUSER: String(user),
        PGDATABASE: String(database),
        PGSSLMODE: "verify-full",
        PGGSSENCMODE: "disable",
        PGSSLROOTCERT: ca.rootCert,
        SA360_BOUNDARY_B_TLS: "verify-full",
        SA360_BOUNDARY_B_REPO_ROOT: path.resolve(repoRoot ?? repoRootDefault),
        SA360_BOUNDARY_B_ARTIFACTS: path.resolve(artifactsRoot ?? artifactsRootDefault),
        ...(hostaddr ? { PGHOSTADDR: String(hostaddr) } : {}),
      },
    };
  } catch (error) {
    return { ok: false, code: error.code || "tls_conninfo_rejected" };
  }
}

export function operatorDisposableLoopback({ host, port, user, database }) {
  if (process.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION === "yes") return { ok: false, code: "operator_tls_required" };
  if (host !== "127.0.0.1") return { ok: false, code: "operator_tls_required" };
  try {
    const conninfo = [
      `host=${conninfoToken(host)}`,
      `port=${conninfoToken(port)}`,
      `user=${conninfoToken(user)}`,
      `dbname=${conninfoToken(database)}`,
      "sslmode=disable",
      "gssencmode=disable",
    ].join(" ");
    return {
      ok: true,
      conninfo,
      env: {
        PGHOST: "127.0.0.1",
        PGPORT: String(port),
        PGUSER: String(user),
        PGDATABASE: String(database),
        PGSSLMODE: "disable",
        PGGSSENCMODE: "disable",
        SA360_BOUNDARY_B_TLS: "disposable-loopback",
      },
    };
  } catch (error) {
    return { ok: false, code: error.code || "operator_tls_required" };
  }
}

function pgpassField(value) {
  return escapePgpass(value);
}

async function waitForFile(file, timeoutMs) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      accessSync(file, constants.R_OK);
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
  disposableLoopback = false,
  repoRoot,
  artifactsRoot,
}) {
  let session;
  if (disposableLoopback) {
    if (sslmode !== "disable") return { ok: false, code: "operator_tls_required" };
    session = operatorDisposableLoopback({ host, port: String(port), user: adminUser, database });
  } else {
    if (sslmode === "disable" || sslmode === "allow" || sslmode === "prefer") {
      return { ok: false, code: "operator_tls_required" };
    }
    session = operatorVerifyFull({
      host,
      port: String(port),
      user: adminUser,
      database,
      rootCert,
      hostaddr,
      repoRoot,
      artifactsRoot,
    });
  }
  if (!session.ok) return { ok: false, code: session.code };
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
    PGCONNECT_TIMEOUT: "10",
    PGPASSFILE: pgpass,
    HOME: directory,
    ...session.env,
  };
  if (process.env.SA360_BOUNDARY_B_ALLOW_PRODUCTION === "yes") env.SA360_BOUNDARY_B_ALLOW_PRODUCTION = "yes";
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

/**
 * Canonical App Platform spec fingerprint.
 * Reads one app spec JSON object from stdin (or { app: { spec } } / { spec }).
 * Prints the sha256 and the database-binding classes. Never prints secret values,
 * hosts, passwords, or ciphertext.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

function classify(env) {
  const key = env?.key ?? null;
  const raw = env?.value;
  const row = {
    key,
    type: env?.type ?? null,
    scope: env?.scope ?? null,
  };
  if (key === "DATABASE_URL" || key === "REDIS_URL") {
    if (typeof raw === "string" && (raw.startsWith("postgres") || raw.startsWith("redis"))) {
      const parsed = new URL(raw);
      row.class = {
        kind: "url",
        user: decodeURIComponent(parsed.username),
        database: decodeURIComponent(parsed.pathname.replace(/^\//, "")),
        port: parsed.port ? Number(parsed.port) : null,
        sslmode: parsed.searchParams.get("sslmode"),
        query_keys: [...parsed.searchParams.keys()].sort(),
        has_password: Boolean(parsed.password),
        host_set: Boolean(parsed.hostname),
      };
    } else if (env?.type === "SECRET" || (typeof raw === "string" && raw.startsWith("EV["))) {
      row.class = { kind: "secret" };
    } else if (typeof raw === "string" && raw.startsWith("${") && raw.endsWith("}")) {
      row.class = { kind: "binding", binding: raw };
    } else {
      row.class = { kind: "other" };
    }
  }
  return row;
}

function byKey(left, right) {
  const a = String(left.key);
  const b = String(right.key);
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function specShape(spec) {
  const components = [];
  for (const kind of ["services", "workers", "jobs", "static_sites", "functions"]) {
    for (const component of spec?.[kind] ?? []) {
      const github = component.github ?? {};
      components.push({
        kind,
        name: component.name ?? null,
        run_command: component.run_command ?? null,
        github: {
          repo: github.repo ?? null,
          branch: github.branch ?? null,
          deploy_on_push: github.deploy_on_push ?? null,
        },
        envs: [...(component.envs ?? [])].map(classify).sort(byKey),
      });
    }
  }
  return {
    name: spec?.name ?? null,
    databases: [...(spec?.databases ?? [])].map((entry) => entry?.name ?? null).sort(),
    app_envs: [...(spec?.envs ?? [])].map(classify).sort(byKey),
    components,
  };
}

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function specFingerprint(spec) {
  return createHash("sha256").update(canonicalize(specShape(spec))).digest("hex");
}

function databaseClasses(shape) {
  const rows = [];
  for (const env of shape.app_envs) {
    if (env.key === "DATABASE_URL" || env.key === "REDIS_URL") {
      rows.push({ level: "app", ...env });
    }
  }
  for (const component of shape.components) {
    for (const env of component.envs) {
      if (env.key === "DATABASE_URL" || env.key === "REDIS_URL") {
        rows.push({ level: component.kind, component: component.name, ...env });
      }
    }
  }
  return rows;
}

const isDirectRun = process.argv[1] && process.argv[1].endsWith("app-spec-shape.mjs");
if (isDirectRun) {
  const input = JSON.parse(readFileSync(0, "utf8"));
  const spec = input?.app?.spec ?? input?.spec ?? input;
  const shape = specShape(spec);
  process.stdout.write(
    `${JSON.stringify({
      fingerprint: specFingerprint(spec),
      databases: shape.databases,
      bindings: databaseClasses(shape),
    })}\n`,
  );
}

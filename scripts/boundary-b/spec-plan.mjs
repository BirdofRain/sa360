export function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

const CHANGES = [
  { component: "sa360-api", key: "DATABASE_URL", type: "SECRET", scope: "RUN_TIME" },
  { component: "sa360-worker", key: "DATABASE_URL", type: "SECRET", scope: "RUN_TIME" },
];

function componentIndex(spec, kind, name) {
  const list = Array.isArray(spec?.[kind]) ? spec[kind] : [];
  const indexes = [];
  list.forEach((component, index) => {
    if (component && component.name === name) indexes.push(index);
  });
  return indexes.length === 1 ? indexes[0] : null;
}

function envsOf(component) {
  return Array.isArray(component?.envs) ? component.envs : [];
}

function databaseUrlCount(component) {
  return envsOf(component).filter((env) => env && env.key === "DATABASE_URL").length;
}

function appDatabaseUrls(spec) {
  return (Array.isArray(spec?.envs) ? spec.envs : []).filter((env) => env && env.key === "DATABASE_URL");
}

function childPath(parent, key) {
  return parent ? `${parent}.${key}` : String(key);
}

function isObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function walk(before, after, path, out) {
  if (Object.is(before, after)) return;
  if (Array.isArray(before) && Array.isArray(after)) {
    const shared = Math.min(before.length, after.length);
    for (let index = 0; index < shared; index += 1) {
      walk(before[index], after[index], childPath(path, index), out);
    }
    for (let index = shared; index < before.length; index += 1) out.push(childPath(path, index));
    for (let index = shared; index < after.length; index += 1) out.push(childPath(path, index));
    return;
  }
  if (isObject(before) && isObject(after)) {
    const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
    for (const key of keys) walk(before[key], after[key], childPath(path, key), out);
    return;
  }
  out.push(path || "$");
}

function normalizeTargets(spec) {
  const copy = structuredClone(spec);
  for (const [kind, name] of [
    ["services", "sa360-api"],
    ["workers", "sa360-worker"],
  ]) {
    const index = componentIndex(copy, kind, name);
    if (index === null) continue;
    if (!Array.isArray(copy[kind][index].envs)) copy[kind][index].envs = [];
  }
  return copy;
}

export function diffPaths(before, after) {
  const paths = [];
  walk(normalizeTargets(before), normalizeTargets(after), "", paths);
  return paths;
}

function queryKeys(url) {
  return [...url.searchParams.keys()].sort().join(",");
}

function databaseUrlProblems(previous, databaseUrl, rules) {
  const rows = appDatabaseUrls(previous);
  if (rows.length !== 1 || typeof rows[0].value !== "string") return ["app_database_url_count"];
  let adminUrl;
  let nextUrl;
  try {
    adminUrl = new URL(rows[0].value);
    nextUrl = new URL(databaseUrl);
  } catch {
    return ["database_url_unreadable"];
  }
  const problems = [];
  if (!["postgres:", "postgresql:"].includes(adminUrl.protocol) || adminUrl.protocol !== nextUrl.protocol) {
    problems.push("database_protocol");
  }
  if (decodeURIComponent(adminUrl.username) !== rules.adminUser) problems.push("admin_user");
  if (decodeURIComponent(nextUrl.username) !== "sa360_app") problems.push("app_user");
  if (!nextUrl.password) problems.push("app_password_missing");
  if (nextUrl.password && nextUrl.password === adminUrl.password) problems.push("app_password_reused");
  if (nextUrl.hostname !== adminUrl.hostname) problems.push("database_host");
  if (nextUrl.port !== adminUrl.port) problems.push("database_port");
  if (nextUrl.pathname !== adminUrl.pathname) problems.push("database_name");
  if (queryKeys(adminUrl) !== queryKeys(nextUrl)) problems.push("database_query");
  if (adminUrl.searchParams.get("sslmode") !== nextUrl.searchParams.get("sslmode")) problems.push("database_sslmode");
  if (rules.production) {
    if (nextUrl.port !== "25060") problems.push("production_port");
    if (nextUrl.pathname !== "/defaultdb") problems.push("production_database");
    if (nextUrl.searchParams.get("sslmode") !== "require") problems.push("production_sslmode");
    if (rules.adminUser !== "doadmin") problems.push("production_admin_user");
  }
  return problems;
}

function validOverride(env, databaseUrl) {
  if (!env || typeof env !== "object" || Array.isArray(env)) return false;
  const keys = Object.keys(env).sort().join(",");
  return (
    keys === "key,scope,type,value" &&
    env.key === "DATABASE_URL" &&
    env.scope === "RUN_TIME" &&
    env.type === "SECRET" &&
    env.value === databaseUrl
  );
}

export function auditProposedSpec(previous, next, databaseUrl, rules = {}) {
  const adminUser = rules.adminUser ?? "doadmin";
  const appliedRules = { ...rules, adminUser };
  const problems = [];
  const apiIndex = componentIndex(previous, "services", "sa360-api");
  const workerIndex = componentIndex(previous, "workers", "sa360-worker");
  const migrateIndex = componentIndex(previous, "jobs", "sa360-migrate");
  if (apiIndex === null) problems.push("api_missing");
  if (workerIndex === null) problems.push("worker_missing");
  if (migrateIndex === null) problems.push("migrate_missing");
  problems.push(...databaseUrlProblems(previous, databaseUrl, appliedRules));
  if (apiIndex === null || workerIndex === null || migrateIndex === null) {
    return { ok: false, problems: [...new Set(problems)], changes: [] };
  }

  const allowed = new Set([
    `services.${apiIndex}.envs.${envsOf(previous.services[apiIndex]).length}`,
    `workers.${workerIndex}.envs.${envsOf(previous.workers[workerIndex]).length}`,
  ]);
  const paths = diffPaths(previous, next);
  for (const path of paths) {
    if (!allowed.has(path)) problems.push(path);
  }
  if (paths.length !== allowed.size) problems.push("override_count");
  if (!validOverride(next?.services?.[apiIndex]?.envs?.[envsOf(previous.services[apiIndex]).length], databaseUrl)) {
    problems.push("api_override_shape");
  }
  if (!validOverride(next?.workers?.[workerIndex]?.envs?.[envsOf(previous.workers[workerIndex]).length], databaseUrl)) {
    problems.push("worker_override_shape");
  }
  const migrateNext = next?.jobs?.[componentIndex(next, "jobs", "sa360-migrate")];
  if (databaseUrlCount(migrateNext) !== 0) problems.push("migrate_override");
  const unique = [...new Set(problems)];
  return { ok: unique.length === 0, problems: unique, changes: unique.length === 0 ? CHANGES : [] };
}

function appendOverride(spec, kind, name, databaseUrl) {
  const index = componentIndex(spec, kind, name);
  if (index === null) return "component_missing";
  const component = spec[kind][index];
  if (!Array.isArray(component.envs)) component.envs = [];
  if (component.envs.some((env) => env && env.key === "DATABASE_URL")) return "component_database_url_exists";
  component.envs.push({
    key: "DATABASE_URL",
    scope: "RUN_TIME",
    type: "SECRET",
    value: databaseUrl,
  });
  return null;
}

export function planDatabaseUrlOverrides(previous, databaseUrl, rules = {}) {
  const next = structuredClone(previous);
  const appendProblem = appendOverride(next, "services", "sa360-api", databaseUrl) ?? appendOverride(next, "workers", "sa360-worker", databaseUrl);
  if (appendProblem) return { ok: false, problems: [appendProblem], next: null, changes: [] };
  const audit = auditProposedSpec(previous, next, databaseUrl, rules);
  if (!audit.ok) return { ...audit, next: null };
  return { ...audit, next };
}

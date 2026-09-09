import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ACTIONS_DIR = path.join(SRC, "app/actions");
const API_DIR = path.join(SRC, "app/api");

const PUBLIC_PORTAL_ACTIONS = new Set([
  "login.ts",
  "portal-account.ts",
  "portal-login.ts",
  "portal-password-reset.ts",
  "portal-access.ts",
  "portal-invite.ts",
  "portal-register.ts",
]);

const PUBLIC_BFF_PREFIXES = ["client-portal/", "front-office/", "health/"];

function listFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out.sort();
}

test("privileged Admin C.O.C. server actions call requireAdminCocSession", () => {
  const files = fs.readdirSync(ACTIONS_DIR).filter(
    (name) => name.endsWith(".ts") && !name.endsWith(".test.ts")
  );
  const privileged = files.filter((name) => !PUBLIC_PORTAL_ACTIONS.has(name));
  assert.ok(privileged.length >= 15, "expected operator action modules");
  for (const name of privileged) {
    const src = fs.readFileSync(path.join(ACTIONS_DIR, name), "utf8");
    assert.match(
      src,
      /from ["']@\/lib\/admin-coc-session-guard["']/,
      `${name} must import the shared session guard`
    );
    const exports = src.match(/^export async function /gm) ?? [];
    const guards = src.match(/await requireAdminCocSession\(\);/g) ?? [];
    assert.equal(
      guards.length,
      exports.length,
      `${name}: every exported action must call requireAdminCocSession`
    );
  }

  for (const name of PUBLIC_PORTAL_ACTIONS) {
    const src = fs.readFileSync(path.join(ACTIONS_DIR, name), "utf8");
    assert.doesNotMatch(
      src,
      /requireAdminCocSession/,
      `${name} must stay outside the Admin C.O.C. session domain`
    );
  }
});

test("privileged Admin C.O.C. BFF routes check the signed session", () => {
  const files = listFiles(API_DIR, "route.ts").map((full) => path.relative(API_DIR, full));
  const privileged = files.filter(
    (rel) => !PUBLIC_BFF_PREFIXES.some((prefix) => rel.startsWith(prefix))
  );
  assert.ok(privileged.length >= 20, "expected operator BFF routes");
  for (const rel of privileged) {
    const src = fs.readFileSync(path.join(API_DIR, rel), "utf8");
    assert.match(
      src,
      /unauthorizedAdminCocBffResponse/,
      `${rel} must call unauthorizedAdminCocBffResponse`
    );
    const methods = src.match(/^export async function (GET|POST|PUT|PATCH|DELETE)/gm) ?? [];
    const guards = src.match(/unauthorizedAdminCocBffResponse\(\)/g) ?? [];
    assert.ok(
      guards.length >= methods.length,
      `${rel}: every HTTP handler must check the admin session`
    );
  }

  for (const rel of files.filter((rel) =>
    PUBLIC_BFF_PREFIXES.some((prefix) => rel.startsWith(prefix))
  )) {
    const src = fs.readFileSync(path.join(API_DIR, rel), "utf8");
    assert.doesNotMatch(
      src,
      /unauthorizedAdminCocBffResponse/,
      `${rel} must not use Admin C.O.C. session (portal / Front Office / health)`
    );
  }
});

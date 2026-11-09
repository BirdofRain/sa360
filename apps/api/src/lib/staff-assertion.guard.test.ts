import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import test from "node:test";

const repoRoot = join(import.meta.dirname, "../../../..");
const secretName = "SA360_STAFF_ASSERTION_SECRET";
const allowed = new Set([
  "packages/shared/src/staff-assertion.ts",
  "packages/shared/src/staff-assertion.test.ts",
  "apps/api/src/lib/staff-assertion.guard.test.ts",
  "docs/architecture/staff-assertion.md",
]);

function filesUnder(dir: string): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const info = statSync(path);
    if (info.isDirectory()) {
      if (entry === "node_modules" || entry === "dist" || entry === ".next") continue;
      found.push(...filesUnder(path));
      continue;
    }
    found.push(path);
  }
  return found;
}

test("staff assertion signing is not provisioned or registered", () => {
  const roots = [
    join(repoRoot, "apps/api/src"),
    join(repoRoot, "apps/admin-coc/src"),
    join(repoRoot, "apps/worker/src"),
    join(repoRoot, "packages/shared/src"),
    join(repoRoot, "prisma"),
    join(repoRoot, "docs"),
  ];
  const hits: string[] = [];
  for (const root of roots) {
    for (const path of filesUnder(root)) {
      const rel = relative(repoRoot, path);
      if (allowed.has(rel)) continue;
      const text = readFileSync(path, "utf8");
      if (text.includes(secretName) || text.includes("staff-assertion") || text.includes("x-sa360-staff-assertion")) {
        hits.push(rel);
      }
    }
  }
  assert.deepEqual(hits, []);

  for (const name of [".env", ".env.example", ".env.local"]) {
    try {
      const text = readFileSync(join(repoRoot, name), "utf8");
      assert.equal(text.includes(secretName), false, name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  const app = readFileSync(join(repoRoot, "apps/api/src/app.ts"), "utf8");
  assert.equal(app.includes("staff"), false);
  const barrel = readFileSync(join(repoRoot, "packages/shared/src/index.ts"), "utf8");
  assert.equal(barrel.includes("staff-assertion"), false);
});

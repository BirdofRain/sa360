import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

function listFiles(dir: string, suffix: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(full, suffix));
    else if (entry.name.endsWith(suffix)) out.push(full);
  }
  return out.sort();
}

test("LeadCapture source ownership fields stay off customer-facing modules", () => {
  const roots = [
    path.join(SRC, "client-portal"),
    path.join(SRC, "components/client-portal"),
    path.join(SRC, "components/public-site"),
    path.join(SRC, "app/portal"),
    path.join(SRC, "app/get-started"),
  ];
  const files = roots.flatMap((dir) =>
    fs.existsSync(dir) ? listFiles(dir, "").filter((f) => f.endsWith(".ts") || f.endsWith(".tsx")) : []
  );
  assert.ok(files.length > 10, "expected customer-facing files");
  const forbidden = /\bparentUrlKey\b|\bpageSlug\b|\bproviderFunnelId\b|\bassociationStatus\b|\bsuggestedClientAccountId\b/;
  for (const file of files) {
    const src = fs.readFileSync(file, "utf8");
    assert.doesNotMatch(src, forbidden, path.relative(SRC, file));
  }
});

test("LeadCapture source association UI never exposes the Admin API key to the browser", () => {
  const section = fs.readFileSync(
    path.join(SRC, "components/clients/leadcapture-sources-section.tsx"),
    "utf8"
  );
  assert.doesNotMatch(section, /SA360_ADMIN_API_KEY|ADMIN_API_KEY|x-sa360-admin-key/);
  assert.doesNotMatch(section, /NEXT_PUBLIC_.*ADMIN/);
  const actions = fs.readFileSync(path.join(SRC, "app/actions/source-funnels.ts"), "utf8");
  assert.match(actions, /requireAdminCocSession/);
  const server = fs.readFileSync(path.join(SRC, "lib/admin-api/source-funnels-server.ts"), "utf8");
  assert.match(server, /import ["']server-only["']/);
});

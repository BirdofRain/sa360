#!/usr/bin/env node
/**
 * Prisma migration safety guard.
 *
 * Wraps the destructive `prisma migrate dev`, `prisma migrate reset`, and
 * `prisma db push` subcommands so they cannot accidentally run against a
 * remote DATABASE_URL (DigitalOcean, or any other `sslmode=require` non-local
 * host). `prisma migrate deploy` is allowed against remote DBs by design —
 * that's its production purpose — but the guard still logs the destination
 * host so operators can see what they're about to hit.
 *
 * Usage (forwarded args go to the underlying prisma command):
 *   tsx scripts/prisma-guard.ts <migrate-dev|migrate-reset|db-push|migrate-deploy> [...prisma args]
 *
 * Emergency override (rare; use only when you really mean it):
 *   ALLOW_REMOTE_PRISMA_MIGRATE=1 tsx scripts/prisma-guard.ts <cmd> ...
 */
import "dotenv/config";
import { spawnSync } from "node:child_process";

type SubCmd = "migrate-dev" | "migrate-reset" | "db-push" | "migrate-deploy";

const SUBCOMMAND_MAP: Record<SubCmd, readonly string[]> = {
  "migrate-dev": ["migrate", "dev"],
  "migrate-reset": ["migrate", "reset"],
  "db-push": ["db", "push"],
  "migrate-deploy": ["migrate", "deploy"],
};

/** Subcommands that can rewrite or destroy data. Always rejected when remote. */
const DESTRUCTIVE_LOCAL_ONLY: ReadonlySet<SubCmd> = new Set([
  "migrate-dev",
  "migrate-reset",
  "db-push",
]);

/** Substring patterns that unambiguously mean "remote managed Postgres". */
const REMOTE_HOST_PATTERNS: readonly RegExp[] = [/ondigitalocean\.com/i];

const LOCAL_HOSTS: ReadonlySet<string> = new Set([
  "localhost",
  "127.0.0.1",
  "::1",
  "0.0.0.0",
  "",
]);

function isSubCmd(v: unknown): v is SubCmd {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(SUBCOMMAND_MAP, v);
}

function parseHost(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

function classifyDatabaseUrl(url: string): {
  host: string;
  isLikelyRemote: boolean;
  reason: string;
} {
  const host = parseHost(url);
  for (const re of REMOTE_HOST_PATTERNS) {
    if (re.test(url)) {
      return {
        host,
        isLikelyRemote: true,
        reason: `matches known remote pattern ${re}`,
      };
    }
  }
  const usesSslRequire = /[?&]sslmode=require/i.test(url);
  if (usesSslRequire && host && !LOCAL_HOSTS.has(host)) {
    return {
      host,
      isLikelyRemote: true,
      reason: `sslmode=require with non-local host (${host})`,
    };
  }
  return {
    host,
    isLikelyRemote: false,
    reason: host && !LOCAL_HOSTS.has(host) ? `non-local host ${host}` : "local",
  };
}

function abort(lines: readonly string[]): never {
  for (const l of lines) {
    process.stderr.write(`[prisma-guard] ${l}\n`);
  }
  process.exit(1);
}

function info(line: string): void {
  process.stderr.write(`[prisma-guard] ${line}\n`);
}

function forwardToPrisma(args: readonly string[], extra: readonly string[]): never {
  const result = spawnSync("prisma", [...args, ...extra], {
    stdio: "inherit",
    // Windows needs shell:true so npm/pnpm shim files (prisma.cmd) can resolve.
    shell: process.platform === "win32",
    env: process.env,
  });
  if (result.error) {
    abort([`Failed to spawn prisma: ${result.error.message}`]);
  }
  process.exit(result.status ?? 0);
}

// ── Main ────────────────────────────────────────────────────────────────────

const [, , rawCmd, ...passthrough] = process.argv;

if (!isSubCmd(rawCmd)) {
  abort([
    `Unknown subcommand: ${rawCmd ?? "(missing)"}`,
    `Expected one of: ${Object.keys(SUBCOMMAND_MAP).join(", ")}`,
  ]);
}

const cmd: SubCmd = rawCmd;

const url = process.env.DATABASE_URL?.trim() ?? "";
if (!url) {
  abort([
    "DATABASE_URL is not set.",
    "Refusing to run any Prisma command without an explicit DATABASE_URL.",
    "Set it in .env (loaded automatically) or your shell, e.g.",
    "  DATABASE_URL=postgresql://postgres:postgres@localhost:5432/sa360_local",
  ]);
}

const classified = classifyDatabaseUrl(url);
const bypass = process.env.ALLOW_REMOTE_PRISMA_MIGRATE === "1";

if (DESTRUCTIVE_LOCAL_ONLY.has(cmd) && classified.isLikelyRemote && !bypass) {
  abort([
    "REFUSING destructive Prisma command against a remote DATABASE_URL.",
    `  command: ${cmd}`,
    `  host:    ${classified.host || "(unparseable)"}`,
    `  reason:  ${classified.reason}`,
    "",
    "What to do:",
    "  - For production schema deploys:   pnpm prisma:deploy",
    "    (runs 'prisma migrate deploy' — additive, safe for prod).",
    "  - For local development:           point DATABASE_URL at a local Postgres,",
    "                                     then retry.",
    "  - Emergency override (rare):       ALLOW_REMOTE_PRISMA_MIGRATE=1 pnpm <script>",
    "    Migrate dev / reset / db push can rewrite or destroy data — be very sure.",
  ]);
}

if (cmd === "migrate-deploy") {
  info(
    `prisma migrate deploy → ${
      classified.isLikelyRemote ? "REMOTE" : "LOCAL"
    } (${classified.host || "?"})`
  );
}

forwardToPrisma(SUBCOMMAND_MAP[cmd], passthrough);

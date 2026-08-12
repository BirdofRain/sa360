/**
 * Loaded before other test imports so redis/db use test-mode settings.
 *
 * Root .env may supply non-DB test config (admin keys, etc.), but DATABASE_URL
 * from that file — including production — must never authorize Prisma mutation
 * tests. Only SA360_TEST_DATABASE_URL (validated local test DB) may set
 * process.env.DATABASE_URL after dotenv runs.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

import { installTestDatabaseUrlLock } from "../lib/safe-test-database-url.js";

process.env.NODE_ENV ??= "test";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../");
dotenv.config({ path: path.join(repoRoot, ".env") });

// Wipe ambient/general DATABASE_URL (including any value just loaded from .env)
// and authorize only SA360_TEST_DATABASE_URL when present and safe.
installTestDatabaseUrlLock();

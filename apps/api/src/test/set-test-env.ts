/** Loaded before other test imports so redis/db use test-mode settings. */
import path from "node:path";
import { fileURLToPath } from "node:url";

import dotenv from "dotenv";

process.env.NODE_ENV ??= "test";

// Load monorepo root .env so Prisma-backed tests see DATABASE_URL (never committed).
const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "../../../../");
dotenv.config({ path: path.join(repoRoot, ".env") });

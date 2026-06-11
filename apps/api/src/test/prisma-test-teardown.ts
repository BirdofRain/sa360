import { after } from "node:test";
import { prisma } from "../lib/db.js";

/**
 * Release Prisma pool slots when a test file finishes (each file may run in its own worker).
 * Complements db.ts beforeExit disconnect; helps parallel runs against small Postgres instances.
 */
after(async () => {
  await prisma.$disconnect();
});

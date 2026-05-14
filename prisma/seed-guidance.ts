/**
 * Idempotent Phase 1 Agent Workspace guidance seed.
 *
 * Safety: requires ALLOW_GUIDANCE_SEED=true (or 1/yes). In production-shaped
 * environments, also requires CONFIRM_GUIDANCE_SEED_PRODUCTION=true.
 *
 * Does NOT seed: ClientScriptAssignment (requires real clientAccountId),
 * ContactGuidanceEvent, AgentWorkspaceAction (runtime data).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import {
  GuidanceResourceType,
  ObjectionPlaybookKey,
  PrismaClient,
} from "@prisma/client";

const prisma = new PrismaClient();

const RESOURCE_TYPES = new Set<string>(Object.values(GuidanceResourceType));
const OBJECTION_KEYS = new Set<string>(Object.values(ObjectionPlaybookKey));

type SeedJson = {
  schemaVersion: number;
  resources: Array<{
    slug: string;
    resourceType: string;
    nicheKey?: string | null;
    lifecycleStage?: string | null;
    clientAccountId?: string | null;
    title: string;
    body: string;
    tags?: string[];
  }>;
  objectionPlaybooks: Array<{
    objectionKey: string;
    nicheKey?: string | null;
    clientAccountId?: string | null;
    title: string;
    recommendedResponse: string;
    followUpMessage?: string | null;
    nextBestAction?: string | null;
  }>;
};

function assertSeedAllowed(): void {
  const raw = process.env.ALLOW_GUIDANCE_SEED?.trim().toLowerCase();
  if (!raw || !["1", "true", "yes", "y", "on"].includes(raw)) {
    throw new Error(
      "Guidance seed refused: set ALLOW_GUIDANCE_SEED=true (or 1/yes). " +
        "This script never runs without an explicit opt-in."
    );
  }

  const nodeEnv = process.env.NODE_ENV?.trim().toLowerCase();
  const sa360Env = process.env.SA360_ENV?.trim().toLowerCase();
  const isProdLike = nodeEnv === "production" || sa360Env === "production";
  if (isProdLike) {
    const confirm = process.env.CONFIRM_GUIDANCE_SEED_PRODUCTION?.trim().toLowerCase();
    if (!["1", "true", "yes"].includes(confirm ?? "")) {
      throw new Error(
        "Production-shaped environment detected (NODE_ENV or SA360_ENV is production). " +
          "Set CONFIRM_GUIDANCE_SEED_PRODUCTION=true after reviewing DATABASE_URL and backup policy."
      );
    }
  }
}

function normOptionalString(v: string | null | undefined): string | null {
  if (v === undefined || v === null) return null;
  const t = v.trim();
  return t.length ? t : null;
}

function tagsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = [...a].map((s) => s.trim()).sort();
  const sb = [...b].map((s) => s.trim()).sort();
  return sa.every((v, i) => v === sb[i]);
}

function loadSeedJson(): SeedJson {
  const filePath = path.join(process.cwd(), "data/guidance/phase1-guidance.seed.json");
  const raw = readFileSync(filePath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object") {
    throw new Error("Invalid seed JSON: expected object");
  }
  const o = parsed as Record<string, unknown>;
  if (o.schemaVersion !== 1) {
    throw new Error(`Unsupported schemaVersion: ${String(o.schemaVersion)}`);
  }
  if (!Array.isArray(o.resources) || !Array.isArray(o.objectionPlaybooks)) {
    throw new Error("Invalid seed JSON: resources and objectionPlaybooks must be arrays");
  }
  return parsed as SeedJson;
}

async function upsertGuidanceResource(
  rec: SeedJson["resources"][number],
  stats: { created: number; updated: number; unchanged: number }
): Promise<void> {
  const clientAccountId = normOptionalString(rec.clientAccountId);
  const nicheKey = normOptionalString(rec.nicheKey);
  const lifecycleStage = normOptionalString(rec.lifecycleStage);
  const slug = rec.slug?.trim();
  if (!slug) throw new Error("Resource missing slug");

  if (!RESOURCE_TYPES.has(rec.resourceType)) {
    throw new Error(`Unknown resourceType for slug ${slug}: ${rec.resourceType}`);
  }
  const resourceType = rec.resourceType as GuidanceResourceType;

  if (clientAccountId !== null) {
    throw new Error(`Seed file only supports global resources (clientAccountId null); slug=${slug}`);
  }

  const title = rec.title?.trim() || "";
  const body = rec.body ?? "";
  const tags = Array.isArray(rec.tags) ? rec.tags.map((t) => String(t).trim()).filter(Boolean) : [];

  const existing = await prisma.guidanceResource.findFirst({
    where: {
      clientAccountId: null,
      slug,
      resourceType,
      nicheKey,
    },
  });

  if (!existing) {
    const created = await prisma.guidanceResource.create({
      data: {
        clientAccountId: null,
        nicheKey,
        lifecycleStage,
        resourceType,
        title,
        slug,
        body,
        tags,
        isActive: true,
      },
    });
    await prisma.guidanceResourceVersion.create({
      data: {
        resourceId: created.id,
        version: 1,
        title,
        body,
      },
    });
    stats.created += 1;
    return;
  }

  const same =
    existing.title === title &&
    existing.body === body &&
    tagsEqual(existing.tags, tags) &&
    normOptionalString(existing.lifecycleStage) === lifecycleStage &&
    existing.isActive === true;

  if (same) {
    stats.unchanged += 1;
    return;
  }

  const maxRow = await prisma.guidanceResourceVersion.aggregate({
    where: { resourceId: existing.id },
    _max: { version: true },
  });
  const nextVersion = (maxRow._max.version ?? 0) + 1;

  await prisma.$transaction([
    prisma.guidanceResource.update({
      where: { id: existing.id },
      data: { title, body, tags, isActive: true, nicheKey, lifecycleStage },
    }),
    prisma.guidanceResourceVersion.create({
      data: {
        resourceId: existing.id,
        version: nextVersion,
        title,
        body,
      },
    }),
  ]);
  stats.updated += 1;
}

async function upsertObjectionPlaybook(
  rec: SeedJson["objectionPlaybooks"][number],
  stats: { created: number; updated: number; unchanged: number }
): Promise<void> {
  const clientAccountId = normOptionalString(rec.clientAccountId);
  const nicheKey = normOptionalString(rec.nicheKey);
  if (clientAccountId !== null) {
    throw new Error(
      `Seed file only supports global playbooks (clientAccountId null); objection=${rec.objectionKey}`
    );
  }
  if (!OBJECTION_KEYS.has(rec.objectionKey)) {
    throw new Error(`Unknown objectionKey: ${rec.objectionKey}`);
  }
  const objectionKey = rec.objectionKey as ObjectionPlaybookKey;

  const title = rec.title?.trim() || "";
  const recommendedResponse = rec.recommendedResponse ?? "";
  const followUpMessage = normOptionalString(rec.followUpMessage);
  const nextBestAction = normOptionalString(rec.nextBestAction);

  const existing = await prisma.objectionPlaybook.findFirst({
    where: {
      clientAccountId: null,
      objectionKey,
      nicheKey,
    },
  });

  if (!existing) {
    await prisma.objectionPlaybook.create({
      data: {
        clientAccountId: null,
        nicheKey,
        objectionKey,
        title,
        recommendedResponse,
        followUpMessage,
        nextBestAction,
        isActive: true,
      },
    });
    stats.created += 1;
    return;
  }

  const same =
    existing.title === title &&
    existing.recommendedResponse === recommendedResponse &&
    normOptionalString(existing.followUpMessage) === followUpMessage &&
    normOptionalString(existing.nextBestAction) === nextBestAction &&
    existing.isActive === true;

  if (same) {
    stats.unchanged += 1;
    return;
  }

  await prisma.objectionPlaybook.update({
    where: { id: existing.id },
    data: {
      title,
      recommendedResponse,
      followUpMessage,
      nextBestAction,
      isActive: true,
    },
  });
  stats.updated += 1;
}

async function main(): Promise<void> {
  assertSeedAllowed();
  const data = loadSeedJson();

  const resStats = { created: 0, updated: 0, unchanged: 0 };
  const pbStats = { created: 0, updated: 0, unchanged: 0 };

  for (const r of data.resources) {
    await upsertGuidanceResource(r, resStats);
  }
  for (const p of data.objectionPlaybooks) {
    await upsertObjectionPlaybook(p, pbStats);
  }

  console.log("Guidance seed complete.");
  console.log(
    `  GuidanceResource: created=${resStats.created} updated=${resStats.updated} unchanged=${resStats.unchanged}`
  );
  console.log(
    `  ObjectionPlaybook: created=${pbStats.created} updated=${pbStats.updated} unchanged=${pbStats.unchanged}`
  );
}

main()
  .catch((err: unknown) => {
    console.error("seed-guidance failed:", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

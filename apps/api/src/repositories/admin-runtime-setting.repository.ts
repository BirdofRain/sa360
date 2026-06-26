import type {
  AdminRuntimeSetting,
  AdminRuntimeSettingEnvironment,
  AdminRuntimeSettingScope,
  Prisma,
} from "@prisma/client";
import { prisma } from "../lib/db.js";

export type RuntimeSettingLocator = {
  key: string;
  scope: AdminRuntimeSettingScope;
  environment: AdminRuntimeSettingEnvironment;
  clientAccountId: string | null;
  subaccountIdGhl: string | null;
};

export type RuntimeSettingWriteData = RuntimeSettingLocator & {
  value: Prisma.InputJsonValue;
  description?: string | null;
  reason?: string | null;
  isSensitive?: boolean;
  isEditable?: boolean;
  updatedBy?: string | null;
};

export type RuntimeSettingListFilters = {
  key?: string;
  scope?: AdminRuntimeSettingScope;
  environment?: AdminRuntimeSettingEnvironment;
  clientAccountId?: string;
  subaccountIdGhl?: string;
};

/**
 * In-memory store used by tests so service logic can be exercised without a live DB.
 * Production paths always use Prisma.
 */
class InMemoryRuntimeSettingStore {
  private rows = new Map<string, AdminRuntimeSetting>();
  private seq = 0;

  private locatorKey(l: RuntimeSettingLocator): string {
    return [
      l.key,
      l.scope,
      l.environment,
      l.clientAccountId ?? "\u0000",
      l.subaccountIdGhl ?? "\u0000",
    ].join("|");
  }

  find(l: RuntimeSettingLocator): AdminRuntimeSetting | null {
    return this.rows.get(this.locatorKey(l)) ?? null;
  }

  upsert(data: RuntimeSettingWriteData): AdminRuntimeSetting {
    const id = this.locatorKey(data);
    const existing = this.rows.get(id);
    const now = new Date();
    const row: AdminRuntimeSetting = {
      id: existing?.id ?? `mem_${++this.seq}`,
      key: data.key,
      value: data.value as AdminRuntimeSetting["value"],
      scope: data.scope,
      clientAccountId: data.clientAccountId,
      subaccountIdGhl: data.subaccountIdGhl,
      environment: data.environment,
      description: data.description ?? existing?.description ?? null,
      reason: data.reason ?? null,
      isSensitive: data.isSensitive ?? existing?.isSensitive ?? false,
      isEditable: data.isEditable ?? existing?.isEditable ?? true,
      updatedBy: data.updatedBy ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    this.rows.set(id, row);
    return row;
  }

  list(filters: RuntimeSettingListFilters): AdminRuntimeSetting[] {
    return [...this.rows.values()].filter((row) => {
      if (filters.key !== undefined && row.key !== filters.key) return false;
      if (filters.scope !== undefined && row.scope !== filters.scope) return false;
      if (filters.environment !== undefined && row.environment !== filters.environment)
        return false;
      if (
        filters.clientAccountId !== undefined &&
        row.clientAccountId !== filters.clientAccountId
      )
        return false;
      if (
        filters.subaccountIdGhl !== undefined &&
        row.subaccountIdGhl !== filters.subaccountIdGhl
      )
        return false;
      return true;
    });
  }

  clear(): void {
    this.rows.clear();
    this.seq = 0;
  }
}

let testStore: InMemoryRuntimeSettingStore | null = null;

/** Test-only: swap Prisma for an in-memory store (no DATABASE_URL required). */
export function __useInMemoryAdminRuntimeSettingStoreForTests(): void {
  testStore = new InMemoryRuntimeSettingStore();
}

/** Test-only: clear in-memory store rows. */
export function __clearInMemoryAdminRuntimeSettingStoreForTests(): void {
  testStore?.clear();
}

/** Test-only: restore Prisma-backed behavior. */
export function __resetAdminRuntimeSettingStoreForTests(): void {
  testStore = null;
}

function whereFromLocator(l: RuntimeSettingLocator): Prisma.AdminRuntimeSettingWhereInput {
  return {
    key: l.key,
    scope: l.scope,
    environment: l.environment,
    clientAccountId: l.clientAccountId,
    subaccountIdGhl: l.subaccountIdGhl,
  };
}

/**
 * Find the exact row for a locator. Uses findFirst (not findUnique) because the
 * compound unique contains nullable columns, where Postgres treats NULLs as
 * distinct — findFirst with explicit nulls gives deterministic single-row lookup.
 */
export async function findRuntimeSettingExact(
  locator: RuntimeSettingLocator
): Promise<AdminRuntimeSetting | null> {
  if (testStore) return testStore.find(locator);
  try {
    return await prisma.adminRuntimeSetting.findFirst({
      where: whereFromLocator(locator),
    });
  } catch (err) {
    // Table not migrated yet (P2021) → behave as "no setting".
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "P2021") return null;
    throw err;
  }
}

/**
 * Create or update a single setting row for a locator. Implemented as
 * find-then-update/create (instead of Prisma upsert) so it is correct even when
 * the locator contains NULL clientAccountId/subaccountIdGhl (GLOBAL/CLIENT scopes).
 */
export async function upsertRuntimeSetting(
  data: RuntimeSettingWriteData
): Promise<AdminRuntimeSetting> {
  if (testStore) return testStore.upsert(data);

  const existing = await prisma.adminRuntimeSetting.findFirst({
    where: whereFromLocator(data),
    select: { id: true },
  });

  if (existing) {
    return prisma.adminRuntimeSetting.update({
      where: { id: existing.id },
      data: {
        value: data.value,
        description: data.description ?? undefined,
        reason: data.reason ?? null,
        isSensitive: data.isSensitive ?? undefined,
        isEditable: data.isEditable ?? undefined,
        updatedBy: data.updatedBy ?? null,
      },
    });
  }

  return prisma.adminRuntimeSetting.create({
    data: {
      key: data.key,
      value: data.value,
      scope: data.scope,
      environment: data.environment,
      clientAccountId: data.clientAccountId,
      subaccountIdGhl: data.subaccountIdGhl,
      description: data.description ?? null,
      reason: data.reason ?? null,
      isSensitive: data.isSensitive ?? false,
      isEditable: data.isEditable ?? true,
      updatedBy: data.updatedBy ?? null,
    },
  });
}

/** Read-only: list configured settings rows matching optional filters. */
export async function listRuntimeSettings(
  filters: RuntimeSettingListFilters = {}
): Promise<AdminRuntimeSetting[]> {
  if (testStore) return testStore.list(filters);
  try {
    return await prisma.adminRuntimeSetting.findMany({
      where: {
        key: filters.key,
        scope: filters.scope,
        environment: filters.environment,
        clientAccountId: filters.clientAccountId,
        subaccountIdGhl: filters.subaccountIdGhl,
      },
      orderBy: [{ key: "asc" }, { scope: "asc" }, { environment: "asc" }],
    });
  } catch (err) {
    // Table not migrated yet (P2021) → behave as "no settings".
    const code =
      err && typeof err === "object" && "code" in err
        ? String((err as { code: string }).code)
        : "";
    if (code === "P2021") return [];
    throw err;
  }
}

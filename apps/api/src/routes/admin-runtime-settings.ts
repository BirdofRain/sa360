import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { verifyAdminApiKey } from "../lib/admin-auth.js";
import {
  getRuntimeSettingDefinition,
  isAllowedRuntimeSettingKey,
  RUNTIME_SETTING_KEYS,
  type RuntimeSettingKey,
} from "../lib/admin-runtime-settings-keys.js";
import {
  listRuntimeSettings,
  type RuntimeSettingListFilters,
} from "../repositories/admin-runtime-setting.repository.js";
import {
  presentRuntimeSettingForAdmin,
  REDACTED_VALUE,
  resolveRuntimeSetting,
  type RuntimeSettingContext,
  type RuntimeSettingSource,
} from "../services/admin-runtime-settings.service.js";
import {
  runtimeSettingsListQuerySchema,
  runtimeSettingsResolveQuerySchema,
} from "../schemas/admin-runtime-settings.schema.js";

async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<boolean> {
  return verifyAdminApiKey(request, reply);
}

const RESOLVED_FROM: Record<
  RuntimeSettingSource,
  "SUBACCOUNT" | "CLIENT" | "GLOBAL" | "ENV_FALLBACK" | "SAFE_DEFAULT"
> = {
  subaccount: "SUBACCOUNT",
  client: "CLIENT",
  global: "GLOBAL",
  env: "ENV_FALLBACK",
  default: "SAFE_DEFAULT",
};

function keysToInspect(key?: string): RuntimeSettingKey[] {
  if (key && isAllowedRuntimeSettingKey(key)) return [key];
  return [...RUNTIME_SETTING_KEYS];
}

export async function adminRuntimeSettingsRoutes(app: FastifyInstance) {
  /**
   * Read-only: list known/allowed runtime setting keys with their metadata and
   * any configured DB rows (values redacted when sensitive). Read-only — never
   * mutates state and never wires settings into delivery/routing/Meta behavior.
   */
  app.get("/runtime-settings", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = runtimeSettingsListQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        code: "INVALID_QUERY",
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;

    if (q.key !== undefined && !isAllowedRuntimeSettingKey(q.key)) {
      return reply.status(400).send({
        ok: false,
        error: `Unknown runtime setting key: ${q.key}`,
        code: "INVALID_KEY",
      });
    }

    const filters: RuntimeSettingListFilters = {
      key: q.key,
      scope: q.scope,
      environment: q.environment,
      clientAccountId: q.clientAccountId,
      subaccountIdGhl: q.subaccountIdGhl,
    };

    const rows = await listRuntimeSettings(filters);

    const keys = keysToInspect(q.key).map((key) => {
      const def = getRuntimeSettingDefinition(key)!;
      const configured = rows
        .filter((row) => row.key === key)
        .map((row) => presentRuntimeSettingForAdmin(row));
      return {
        key,
        allowedValues: def.allowedValues,
        defaultValue: def.safeDefault,
        isSensitive: def.isSensitive,
        description: def.description,
        configured,
      };
    });

    return reply.send({
      ok: true,
      filters: {
        environment: q.environment ?? null,
        scope: q.scope ?? null,
        clientAccountId: q.clientAccountId ?? null,
        subaccountIdGhl: q.subaccountIdGhl ?? null,
        key: q.key ?? null,
      },
      keys,
    });
  });

  /**
   * Read-only: resolve effective values for a context using the service's
   * SUBACCOUNT > CLIENT > GLOBAL > env fallback > safe default order. Sensitive
   * effective values are redacted.
   */
  app.get("/runtime-settings/resolve", async (request, reply) => {
    if (!(await requireAdmin(request, reply))) return;

    const parsed = runtimeSettingsResolveQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: "Invalid query",
        code: "INVALID_QUERY",
        details: parsed.error.flatten(),
      });
    }
    const q = parsed.data;

    if (q.key !== undefined && !isAllowedRuntimeSettingKey(q.key)) {
      return reply.status(400).send({
        ok: false,
        error: `Unknown runtime setting key: ${q.key}`,
        code: "INVALID_KEY",
      });
    }

    const context: RuntimeSettingContext = {
      environment: q.environment,
      clientAccountId: q.clientAccountId ?? null,
      subaccountIdGhl: q.subaccountIdGhl ?? null,
    };

    const resolved = [];
    for (const key of keysToInspect(q.key)) {
      const def = getRuntimeSettingDefinition(key)!;
      const r = await resolveRuntimeSetting(key, context);
      resolved.push({
        key,
        effectiveValue: r.isSensitive ? REDACTED_VALUE : r.value,
        resolvedFrom: RESOLVED_FROM[r.source],
        environment: r.environment,
        isSensitive: r.isSensitive,
        allowedValues: def.allowedValues,
        defaultValue: def.safeDefault,
        context: {
          environment: r.environment,
          clientAccountId: q.clientAccountId ?? null,
          subaccountIdGhl: q.subaccountIdGhl ?? null,
        },
      });
    }

    return reply.send({
      ok: true,
      context: {
        environment: q.environment ?? null,
        clientAccountId: q.clientAccountId ?? null,
        subaccountIdGhl: q.subaccountIdGhl ?? null,
      },
      resolved,
    });
  });
}

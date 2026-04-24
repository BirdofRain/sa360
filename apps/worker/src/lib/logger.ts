import { Logtail } from "@logtail/node";

type LogLevel = "debug" | "info" | "warn" | "error";

const SERVICE = "sa360-worker" as const;

const LEVEL_ORDER: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function configuredLevel(): LogLevel {
  const raw = (process.env.SA360_LOG_LEVEL || "info").toLowerCase().trim();
  if (raw === "debug" || raw === "info" || raw === "warn" || raw === "error") {
    return raw;
  }
  return "info";
}

function shouldEmit(level: LogLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[configuredLevel()];
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function serializeError(err: Error) {
  return {
    name: err.name,
    message: err.message,
    stack: err.stack?.replace(/\s+/g, " ").trim(),
  };
}

function formatValue(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";

  if (value instanceof Error) {
    return JSON.stringify(serializeError(value));
  }

  if (typeof value === "string") {
    return /^[A-Za-z0-9._:@/-]+$/.test(value) ? value : JSON.stringify(value);
  }

  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    typeof value === "bigint"
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

function normalizeArgs(args: unknown[]) {
  let message = "log";
  const meta: Record<string, unknown> = {};

  if (args.length === 0) {
    return { message, meta };
  }

  const [first, second, ...rest] = args;

  if (typeof first === "string") {
    message = first;
    if (isPlainObject(second)) Object.assign(meta, second);
    else if (second !== undefined) meta.extra = [second];
  } else if (isPlainObject(first) && typeof second === "string") {
    message = second;
    Object.assign(meta, first);
  } else if (first instanceof Error) {
    message = first.message;
    meta.error = serializeError(first);
    if (typeof second === "string") {
      message = second;
    } else if (isPlainObject(second)) {
      Object.assign(meta, second);
    }
  } else if (isPlainObject(first)) {
    Object.assign(meta, first);
  } else {
    message = String(first);
    if (second !== undefined) meta.extra = [second];
  }

  for (const item of rest) {
    if (item instanceof Error) {
      meta.error = serializeError(item);
    } else if (isPlainObject(item)) {
      Object.assign(meta, item);
    } else {
      if (!Array.isArray(meta.extra)) meta.extra = [];
      (meta.extra as unknown[]).push(item);
    }
  }

  return { message, meta };
}

function resolveLogtailEndpoint(): string | undefined {
  const h = process.env.LOGTAIL_INGESTING_HOST?.trim();
  if (!h) return undefined;
  if (h.startsWith("https://") || h.startsWith("http://")) return h;
  return `https://${h}`;
}

const sourceToken = process.env.LOGTAIL_SOURCE_TOKEN?.trim();
const resolvedEndpoint = resolveLogtailEndpoint();

const logtail = sourceToken
  ? new Logtail(sourceToken, {
      ...(resolvedEndpoint ? { endpoint: resolvedEndpoint } : {}),
      ignoreExceptions: true,
    })
  : null;

function emitConsoleStructured(
  prefix: string,
  level: LogLevel,
  message: string,
  meta: Record<string, unknown>
) {
  const row = {
    ts: new Date().toISOString(),
    service: SERVICE,
    prefix,
    level,
    message,
    ...Object.fromEntries(
      Object.entries(meta).filter(([, v]) => v !== undefined)
    ),
  };
  const line = JSON.stringify(row);

  if (level === "error") {
    console.error(line);
    return;
  }
  if (level === "warn") {
    console.warn(line);
    return;
  }
  if (level === "debug") {
    console.debug(line);
    return;
  }
  console.log(line);
}

function emitConsoleLegacy(prefix: string, level: LogLevel, args: unknown[]) {
  const { message, meta } = normalizeArgs(args);
  const parts = [`[${prefix}:${level.toUpperCase()}]`, message];
  const metaEntries = Object.entries(meta).filter(([, v]) => v !== undefined);
  if (metaEntries.length > 0) {
    const kv = metaEntries
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
    parts.push("|", kv);
  }
  const line = parts.join(" ");
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else if (level === "debug") console.debug(line);
  else console.log(line);
}

function emit(prefix: string, level: LogLevel, ...args: unknown[]) {
  if (!shouldEmit(level)) return;

  const { message, meta } = normalizeArgs(args);
  const metaEntries = Object.entries(meta).filter(([, v]) => v !== undefined);

  if (metaEntries.length > 0) {
    emitConsoleStructured(prefix, level, message, Object.fromEntries(metaEntries));
  } else {
    emitConsoleLegacy(prefix, level, args);
  }

  if (!logtail) return;

  const flat: Record<string, unknown> = {
    service: SERVICE,
    message,
    ...Object.fromEntries(metaEntries),
  };

  void (async () => {
    try {
      if (level === "debug") await logtail.debug(message, flat);
      else if (level === "info") await logtail.info(message, flat);
      else if (level === "warn") await logtail.warn(message, flat);
      else await logtail.error(message, flat);
    } catch {
      /* ignore */
    }
  })();
}

export const logger = {
  debug: (...args: unknown[]) => emit("WORKER", "debug", ...args),
  info: (...args: unknown[]) => emit("WORKER", "info", ...args),
  warn: (...args: unknown[]) => emit("WORKER", "warn", ...args),
  error: (...args: unknown[]) => emit("WORKER", "error", ...args),
};

export async function flushLogger(): Promise<void> {
  if (!logtail) return;
  try {
    await logtail.flush();
  } catch {
    /* non-fatal */
  }
}

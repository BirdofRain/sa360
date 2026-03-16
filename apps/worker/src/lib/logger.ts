type LogLevel = "info" | "warn" | "error";

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

  // Support:
  // logger.info("message", { ...meta })
  // logger.info({ ...meta }, "message")
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

function buildLine(prefix: string, level: LogLevel, args: unknown[]) {
  const { message, meta } = normalizeArgs(args);

  const parts = [
    `[${prefix}:${level.toUpperCase()}]`,
    message,
  ];

  const metaEntries = Object.entries(meta).filter(([, v]) => v !== undefined);

  if (metaEntries.length > 0) {
    const kv = metaEntries
      .map(([key, value]) => `${key}=${formatValue(value)}`)
      .join(" ");
    parts.push("|", kv);
  }

  return parts.join(" ");
}

function emit(prefix: string, level: LogLevel, ...args: unknown[]) {
  const line = buildLine(prefix, level, args);

  if (level === "error") {
    console.error(line);
    return;
  }

  if (level === "warn") {
    console.warn(line);
    return;
  }

  console.log(line);
}

export const logger = {
  info: (...args: unknown[]) => emit("WORKER", "info", ...args),
  warn: (...args: unknown[]) => emit("WORKER", "warn", ...args),
  error: (...args: unknown[]) => emit("WORKER", "error", ...args),
};
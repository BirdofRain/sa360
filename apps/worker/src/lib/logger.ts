function serializeError(err: unknown) {
  if (err instanceof Error) {
    return {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };
  }
  return err;
}

function normalizeArgs(args: unknown[]) {
  const [first, ...rest] = args;

  let message = "log";
  const data: Record<string, unknown> = {};

  if (typeof first === "string") {
    message = first;
  } else if (first instanceof Error) {
    message = first.message;
    data.error = serializeError(first);
  } else if (first && typeof first === "object") {
    Object.assign(data, first as Record<string, unknown>);
  } else if (first !== undefined) {
    message = String(first);
  }

  for (const item of rest) {
    if (item instanceof Error) {
      data.error = serializeError(item);
      continue;
    }

    if (item && typeof item === "object" && !Array.isArray(item)) {
      Object.assign(data, item as Record<string, unknown>);
      continue;
    }

    if (!("extra" in data)) {
      data.extra = [];
    }

    (data.extra as unknown[]).push(item);
  }

  return { message, data };
}

function emit(level: "info" | "warn" | "error", ...args: unknown[]) {
  const { message, data } = normalizeArgs(args);

  const entry = {
    level,
    message,
    service: "sa360-worker",
    ts: new Date().toISOString(),
    ...data,
  };

  const line = JSON.stringify(entry);

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
  info: (...args: unknown[]) => emit("info", ...args),
  warn: (...args: unknown[]) => emit("warn", ...args),
  error: (...args: unknown[]) => emit("error", ...args),
};
export const logger = {
  info: (...args: unknown[]) => console.log("[WORKER:INFO]", ...args),
  warn: (...args: unknown[]) => console.warn("[WORKER:WARN]", ...args),
  error: (...args: unknown[]) => console.error("[WORKER:ERROR]", ...args),
};
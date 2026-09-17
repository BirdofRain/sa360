const GENERIC_ERROR = "Unable to complete Google Sheets destination request";

export function clientAccountIdRejectedResponse(source: unknown): Response | null {
  if (source instanceof URLSearchParams && source.has("clientAccountId")) {
    return Response.json(
      { ok: false, error: "clientAccountId cannot be supplied by the browser" },
      { status: 400 }
    );
  }
  if (source && typeof source === "object" && !Array.isArray(source) && "clientAccountId" in source) {
    return Response.json(
      { ok: false, error: "clientAccountId cannot be supplied by the browser" },
      { status: 400 }
    );
  }
  return null;
}

export function sheetsBffErrorResponse(result: { status: number; body: string }): Response {
  let parsed: { error?: unknown; retryable?: unknown } | null = null;
  try {
    parsed = JSON.parse(result.body) as { error?: unknown; retryable?: unknown };
  } catch {
    parsed = null;
  }
  const error = typeof parsed?.error === "string" ? parsed.error : GENERIC_ERROR;
  return Response.json(
    {
      ok: false,
      error,
      ...(parsed?.retryable === true ? { retryable: true } : {}),
    },
    { status: result.status || 502 }
  );
}

export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const body = (await request.json()) as unknown;
    if (body && typeof body === "object" && !Array.isArray(body)) {
      return body as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}

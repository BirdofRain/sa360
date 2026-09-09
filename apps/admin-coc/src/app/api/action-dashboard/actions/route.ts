import { adminRequestJson } from "@/lib/admin-api/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(req: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const body = await req.text();
  let parsed: unknown;
  try {
    parsed = body ? JSON.parse(body) : {};
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  const res = await adminRequestJson<Record<string, unknown>>(
    "POST",
    "/admin/v1/action-dashboard/actions",
    parsed
  );

  if (!res.ok) {
    let payload: unknown = { ok: false, error: res.body };
    try {
      payload = res.body ? JSON.parse(res.body) : payload;
    } catch {
      /* keep string error */
    }
    return Response.json(payload, { status: res.status || 502 });
  }

  return Response.json(res.data);
}

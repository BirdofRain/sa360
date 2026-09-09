import { workspaceProxyFetch } from "@/lib/agent-workspace-api/config";
import { NextRequest } from "next/server";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function GET(req: NextRequest) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const qs = req.nextUrl.searchParams.toString();
  const path = `/agent-workspace/v1/context${qs ? `?${qs}` : ""}`;
  const res = await workspaceProxyFetch(path);
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

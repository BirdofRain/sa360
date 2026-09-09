import { workspaceProxyFetch } from "@/lib/agent-workspace-api/config";
import { unauthorizedAdminCocBffResponse } from "@/lib/admin-coc-session-guard";

export async function POST(req: Request) {
  const denied = await unauthorizedAdminCocBffResponse();
  if (denied) return denied;
  const body = await req.text();
  const res = await workspaceProxyFetch("/agent-workspace/v1/actions/what-happened", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  const text = await res.text();
  return new Response(text, {
    status: res.status,
    headers: { "Content-Type": res.headers.get("Content-Type") ?? "application/json" },
  });
}

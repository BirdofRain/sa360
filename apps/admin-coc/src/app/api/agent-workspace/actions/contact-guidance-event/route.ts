import { workspaceProxyFetch } from "@/lib/agent-workspace-api/config";

export async function POST(req: Request) {
  const body = await req.text();
  const res = await workspaceProxyFetch("/agent-workspace/v1/actions/contact-guidance-event", {
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

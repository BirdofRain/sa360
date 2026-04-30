import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function SettingsPage() {
  return (
    <div className="max-w-2xl space-y-4">
      <Card className="shadow-none" id="health">
        <CardHeader>
          <CardTitle>API base URL</CardTitle>
          <CardDescription>
            Set <code className="rounded bg-muted px-1 py-0.5 font-mono text-xs">NEXT_PUBLIC_API_BASE_URL</code>{" "}
            to your Fastify origin when admin routes are exposed (e.g. same DO app or internal URL).
          </CardDescription>
        </CardHeader>
        <CardContent>
          <p className="font-mono text-xs text-muted-foreground">
            {process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || "(not set)"}
          </p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Health endpoints</CardTitle>
          <CardDescription>Existing SA360 API checks — not called from this UI yet.</CardDescription>
        </CardHeader>
        <CardContent>
          <ul className="list-inside list-disc space-y-1 font-mono text-xs text-muted-foreground">
            <li>GET /health</li>
            <li>GET /health/db</li>
            <li>GET /health/queue</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

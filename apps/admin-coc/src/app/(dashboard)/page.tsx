import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { StatBlock } from "@/components/dashboard/stat-block";

export default function CommandCenterPage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Today (sample)</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatBlock label="Webhook requests" value="—" hint="Wire to admin API" />
          <StatBlock label="Synthflow lookups" value="—" />
          <StatBlock label="Failed requests" value="0" trend="positive" />
          <StatBlock label="Open review items" value="—" trend="warning" />
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Latest activity</CardTitle>
            <CardDescription>Recent webhook and voice events will appear here.</CardDescription>
          </CardHeader>
          <CardContent>
            <ul className="space-y-3 text-sm text-muted-foreground">
              <li className="flex justify-between gap-4 border-b border-border/60 pb-2">
                <span>No rows yet</span>
                <span className="shrink-0 tabular-nums text-xs">—</span>
              </li>
            </ul>
          </CardContent>
        </Card>
        <Card className="shadow-none">
          <CardHeader>
            <CardTitle>Critical issues</CardTitle>
            <CardDescription>Escalations from review queue and failed dispatches.</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">None — connect data sources to populate.</p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

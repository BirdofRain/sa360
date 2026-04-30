import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ClientsPage() {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Client accounts</CardTitle>
          <CardDescription>Backed by `ClientConfig` and future `SubaccountLink`.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">List view pending admin API.</p>
        </CardContent>
      </Card>
      <Card className="shadow-none">
        <CardHeader>
          <CardTitle>Subaccounts</CardTitle>
          <CardDescription>Map `subaccountIdGhl` to friendly labels for operators.</CardDescription>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Placeholder.</p>
        </CardContent>
      </Card>
    </div>
  );
}

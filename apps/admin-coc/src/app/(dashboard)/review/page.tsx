import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function ReviewPage() {
  return (
    <div className="space-y-4">
      <Card className="shadow-none">
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <div>
            <CardTitle>Open items</CardTitle>
            <CardDescription>Validation failures, unknown subaccount, Meta errors, duplicates.</CardDescription>
          </div>
          <Badge variant="outline" className="rounded-md">
            0
          </Badge>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            `ReviewItem` records will populate this queue from API and worker hooks.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

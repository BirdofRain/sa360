import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

type StatBlockProps = {
  label: string;
  value: string;
  hint?: string;
  trend?: "neutral" | "positive" | "warning" | "negative";
};

const trendClass: Record<NonNullable<StatBlockProps["trend"]>, string> = {
  neutral: "text-muted-foreground",
  positive: "text-emerald-700 dark:text-emerald-400",
  warning: "text-amber-700 dark:text-amber-400",
  negative: "text-destructive",
};

export function StatBlock({ label, value, hint, trend = "neutral" }: StatBlockProps) {
  return (
    <Card size="sm" className="shadow-none">
      <CardHeader className="pb-1">
        <CardTitle className="text-xs font-medium text-muted-foreground">{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <p className={cn("text-2xl font-semibold tabular-nums tracking-tight", trendClass[trend])}>
          {value}
        </p>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </CardContent>
    </Card>
  );
}

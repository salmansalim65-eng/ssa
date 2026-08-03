import type { LucideIcon } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function KpiCard({
  label,
  value,
  subtext,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  subtext?: string;
  icon: LucideIcon;
  tone?: "success" | "destructive" | "warning";
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between gap-2 space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p
          className={cn(
            "text-2xl font-semibold tracking-tight",
            tone === "success" && "text-success",
            tone === "destructive" && "text-destructive",
            tone === "warning" && "text-warning",
          )}
        >
          {value}
        </p>
        {subtext && <p className="text-xs text-muted-foreground">{subtext}</p>}
      </CardContent>
    </Card>
  );
}

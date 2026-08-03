import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export default function DashboardPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Dashboard</h1>
        <p className="text-sm text-muted-foreground">
          KPI cards and charts land in Phase 13, once assets, rentals, and
          accounting have data to summarize.
        </p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>Foundation is live</CardTitle>
          <CardDescription>
            Companies, users, roles &amp; permissions are ready under
            Administration. Currency, chart of accounts, and vouchers ship in
            the phases that follow.
          </CardDescription>
        </CardHeader>
        <CardContent />
      </Card>
    </div>
  );
}

export interface BarChartRow {
  label: string;
  value: number;
}

export function SimpleBarChart({ rows, valueFormatter }: { rows: BarChartRow[]; valueFormatter?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const format = valueFormatter ?? ((n: number) => n.toLocaleString());

  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No data yet.</p>;
  }

  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{r.label}</span>
            <span className="text-muted-foreground">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-muted">
            <div
              className="h-2 rounded-full bg-primary"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

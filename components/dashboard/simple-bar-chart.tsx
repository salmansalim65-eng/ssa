export interface BarChartRow {
  label: string;
  value: number;
}

export function SimpleBarChart({ rows, valueFormatter }: { rows: BarChartRow[]; valueFormatter?: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  const format = valueFormatter ?? ((n: number) => n.toLocaleString());

  if (rows.length === 0) {
    return <p className="text-sm text-header-muted">No data yet.</p>;
  }

  // Rendered inside the dark dashboard cards, so the track and bars use
  // light-on-dark tones (white track wash, logo-green fill).
  return (
    <div className="space-y-3">
      {rows.map((r) => (
        <div key={r.label} className="space-y-1">
          <div className="flex items-center justify-between text-sm">
            <span>{r.label}</span>
            <span className="text-header-muted">{format(r.value)}</span>
          </div>
          <div className="h-2 rounded-full bg-white/15">
            <div
              className="h-2 rounded-full bg-ledger"
              style={{ width: `${Math.max((r.value / max) * 100, r.value > 0 ? 2 : 0)}%` }}
            />
          </div>
        </div>
      ))}
    </div>
  );
}

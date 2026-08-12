"use client";

// Lightweight, dependency-free SVG charts for the Property Report dashboard.
// Kept deliberately restrained (brand green / navy / amber on white) so the
// report reads as a premium real-estate ERP rather than a marketing dashboard.

import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  MoreVerticalIcon,
  Maximize2Icon,
  TableIcon,
  DownloadIcon,
  PrinterIcon,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { toCsv, type CsvCell } from "@/lib/reports/csv";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Muted, professional palette — brand green first, ERP navy second.
export const CHART_COLORS = [
  "#2f8f4e",
  "#3A53A4",
  "#C79A3A",
  "#4B9B8F",
  "#8E6FB3",
  "#B5695A",
  "#5B7C99",
  "#7C9A3E",
];

export function compactNumber(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${(n / 1e9).toFixed(1).replace(/\.0$/, "")}B`;
  if (a >= 1e6) return `${(n / 1e6).toFixed(1).replace(/\.0$/, "")}M`;
  if (a >= 1e3) return `${(n / 1e3).toFixed(1).replace(/\.0$/, "")}K`;
  return String(Math.round(n));
}

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function downloadCsv(filename: string, headers: string[], rows: CsvCell[][]) {
  const blob = new Blob([toCsv(headers, rows)], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

// Measures a container's pixel width so charts lay out crisply (text stays
// unscaled) and reflow on resize.
function useMeasure() {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) setWidth(e.contentRect.width);
    });
    ro.observe(el);
    setWidth(el.getBoundingClientRect().width);
    return () => ro.disconnect();
  }, []);
  return { ref, width };
}

type Tip = { x: number; y: number; lines: string[] } | null;

function Tooltip({ tip }: { tip: Tip }) {
  if (!tip) return null;
  return (
    <div
      className="pointer-events-none absolute z-30 max-w-[220px] rounded-md border bg-popover px-2.5 py-1.5 text-xs shadow-md"
      style={{ left: tip.x, top: tip.y }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={cn(i === 0 ? "font-semibold text-foreground" : "text-muted-foreground")}>
          {l}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ChartCard — rounded panel with a ⋮ menu (Expand / View data / Export / Print)
// ---------------------------------------------------------------------------

export function ChartCard({
  title,
  subtitle,
  csv,
  chart,
  className,
}: {
  title: string;
  subtitle?: string;
  csv?: { headers: string[]; rows: CsvCell[][] };
  chart: (height: number) => ReactNode;
  className?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const [showData, setShowData] = useState(false);

  return (
    <div className={cn("flex flex-col rounded-xl border bg-card p-4 shadow-xs", className)}>
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-foreground">{title}</h3>
          {subtitle && <p className="truncate text-xs text-muted-foreground">{subtitle}</p>}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              aria-label="Chart options"
              className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground print:hidden"
            >
              <MoreVerticalIcon className="size-4" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setExpanded(true)}>
              <Maximize2Icon /> Expand
            </DropdownMenuItem>
            {csv && (
              <DropdownMenuItem onClick={() => setShowData((s) => !s)}>
                <TableIcon /> {showData ? "Hide data" : "View data"}
              </DropdownMenuItem>
            )}
            {csv && (
              <DropdownMenuItem onClick={() => downloadCsv(`${slug(title)}.csv`, csv.headers, csv.rows)}>
                <DownloadIcon /> Export
              </DropdownMenuItem>
            )}
            <DropdownMenuItem onClick={() => window.print()}>
              <PrinterIcon /> Print
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex-1">{chart(240)}</div>

      {showData && csv && <DataPreview headers={csv.headers} rows={csv.rows} />}

      <Dialog open={expanded} onOpenChange={setExpanded}>
        <DialogContent className="max-w-4xl">
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
          </DialogHeader>
          {subtitle && <p className="-mt-2 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="pt-2">{chart(460)}</div>
          {csv && <DataPreview headers={csv.headers} rows={csv.rows} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function DataPreview({ headers, rows }: { headers: string[]; rows: CsvCell[][] }) {
  return (
    <div className="mt-3 max-h-60 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-muted/60">
          <tr>
            {headers.map((h) => (
              <th key={h} className="px-2.5 py-1.5 text-left font-medium text-muted-foreground">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="border-t border-border/60">
              {r.map((c, j) => (
                <td key={j} className={cn("px-2.5 py-1", j === 0 ? "text-foreground" : "text-muted-foreground")}>
                  {String(c)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Donut
// ---------------------------------------------------------------------------

export interface DonutDatum {
  key: string;
  label: string;
  value: number;
  color: string;
}

export function DonutChart({
  data,
  height,
  format,
  centerTitle,
  centerValue,
  activeKey,
  onSelect,
}: {
  data: DonutDatum[];
  height: number;
  format: (n: number) => string;
  centerTitle?: string;
  centerValue?: string;
  activeKey?: string | null;
  onSelect?: (key: string) => void;
}) {
  const { ref, width } = useMeasure();
  const [tip, setTip] = useState<Tip>(null);
  const total = data.reduce((s, d) => s + d.value, 0);

  const size = Math.min(height, width > 0 ? width * 0.55 : height);
  const cx = size / 2;
  const cy = size / 2;
  const rOuter = size / 2 - 6;
  const rInner = rOuter * 0.62;

  const arcs = data.reduce<{ d: DonutDatum; start: number; end: number; frac: number }[]>(
    (list, d) => {
      const frac = total > 0 ? d.value / total : 0;
      const start = list.length ? list[list.length - 1].end : -Math.PI / 2;
      const end = start + frac * Math.PI * 2;
      list.push({ d, start, end, frac });
      return list;
    },
    [],
  );

  function arcPath(start: number, end: number) {
    const pt = (r: number, a: number) => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    const large = end - start > Math.PI ? 1 : 0;
    const [x1, y1] = pt(rOuter, start);
    const [x2, y2] = pt(rOuter, end);
    const [x3, y3] = pt(rInner, end);
    const [x4, y4] = pt(rInner, start);
    return `M${x1},${y1} A${rOuter},${rOuter} 0 ${large} 1 ${x2},${y2} L${x3},${y3} A${rInner},${rInner} 0 ${large} 0 ${x4},${y4} Z`;
  }

  const move = (e: React.MouseEvent, lines: string[]) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, lines });
  };

  return (
    <div ref={ref} className="relative flex items-center gap-4" style={{ minHeight: height }}>
      {width > 0 && (
        <>
          <svg width={size} height={size} className="shrink-0 text-foreground">
            {arcs.map(({ d, start, end, frac }) => {
              const dim = activeKey && activeKey !== d.key;
              return (
                <path
                  key={d.key}
                  d={arcPath(start, end === start ? end + 0.0001 : end)}
                  fill={d.color}
                  opacity={dim ? 0.28 : 1}
                  className={cn("transition-opacity", onSelect && "cursor-pointer")}
                  onMouseMove={(e) =>
                    move(e, [d.label, format(d.value), `${(frac * 100).toFixed(1)}%`])
                  }
                  onMouseLeave={() => setTip(null)}
                  onClick={() => onSelect?.(d.key)}
                />
              );
            })}
            {(centerValue || centerTitle) && (
              <>
                <text x={cx} y={cy - 2} textAnchor="middle" className="fill-current text-base font-bold">
                  {centerValue}
                </text>
                <text
                  x={cx}
                  y={cy + 14}
                  textAnchor="middle"
                  className="fill-current text-[0.6rem] uppercase tracking-wide"
                  opacity={0.55}
                >
                  {centerTitle}
                </text>
              </>
            )}
          </svg>

          <ul className="flex min-w-0 flex-1 flex-col gap-1.5 text-xs">
            {data.map((d) => {
              const frac = total > 0 ? d.value / total : 0;
              const dim = activeKey && activeKey !== d.key;
              return (
                <li key={d.key}>
                  <button
                    type="button"
                    onClick={() => onSelect?.(d.key)}
                    disabled={!onSelect}
                    className={cn(
                      "flex w-full items-center gap-2 rounded px-1 py-0.5 text-left transition-opacity",
                      onSelect && "hover:bg-muted/60",
                      dim && "opacity-40",
                    )}
                  >
                    <span className="size-2.5 shrink-0 rounded-sm" style={{ background: d.color }} />
                    <span className="min-w-0 flex-1 truncate text-foreground">{d.label}</span>
                    <span className="shrink-0 font-medium text-muted-foreground">{(frac * 100).toFixed(0)}%</span>
                  </button>
                </li>
              );
            })}
          </ul>
        </>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Horizontal bar
// ---------------------------------------------------------------------------

export interface HBarDatum {
  key: string;
  label: string;
  value: number;
}

export function HBarChart({
  data,
  height,
  format,
  color = CHART_COLORS[0],
  onSelect,
}: {
  data: HBarDatum[];
  height: number;
  format: (n: number) => string;
  color?: string;
  onSelect?: (key: string) => void;
}) {
  const { ref, width } = useMeasure();
  const [tip, setTip] = useState<Tip>(null);
  const max = Math.max(1, ...data.map((d) => d.value));
  const labelW = Math.min(160, Math.max(90, width * 0.32));
  const rowH = 30;
  const gap = 10;
  const barArea = Math.max(40, width - labelW - 64);

  const move = (e: React.MouseEvent, lines: string[]) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, lines });
  };

  return (
    <div ref={ref} className="relative" style={{ minHeight: height }}>
      {width > 0 && (
        <svg width={width} height={data.length * (rowH + gap)} className="text-foreground">
          {data.map((d, i) => {
            const y = i * (rowH + gap);
            const w = (d.value / max) * barArea;
            return (
              <g
                key={d.key}
                className={cn(onSelect && "cursor-pointer")}
                onMouseMove={(e) => move(e, [d.label, format(d.value)])}
                onMouseLeave={() => setTip(null)}
                onClick={() => onSelect?.(d.key)}
              >
                <text x={0} y={y + rowH / 2} dominantBaseline="middle" className="fill-current text-xs" opacity={0.8}>
                  {d.label.length > 20 ? `${d.label.slice(0, 19)}…` : d.label}
                </text>
                <rect x={labelW} y={y + 4} width={barArea} height={rowH - 8} rx={4} className="fill-current" opacity={0.06} />
                <rect x={labelW} y={y + 4} width={Math.max(2, w)} height={rowH - 8} rx={4} fill={color} />
                <text
                  x={labelW + Math.max(2, w) + 6}
                  y={y + rowH / 2}
                  dominantBaseline="middle"
                  className="fill-current text-[0.7rem] font-medium tabular-nums"
                >
                  {format(d.value)}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Stacked vertical bar
// ---------------------------------------------------------------------------

export interface StackSeries {
  name: string;
  color: string;
}
export interface StackGroup {
  key: string;
  label: string;
  values: Record<string, number>;
}

export function StackedBarChart({
  groups,
  series,
  height,
  format,
  onSelect,
}: {
  groups: StackGroup[];
  series: StackSeries[];
  height: number;
  format: (n: number) => string;
  onSelect?: (key: string) => void;
}) {
  const { ref, width } = useMeasure();
  const [tip, setTip] = useState<Tip>(null);
  const chartH = height - 46; // leave room for x labels + legend
  const pad = 4;
  const totalOf = (g: StackGroup) => series.reduce((s, ser) => s + (g.values[ser.name] || 0), 0);
  const max = Math.max(1, ...groups.map(totalOf));
  const slot = width > 0 ? width / Math.max(1, groups.length) : 0;
  const barW = Math.min(56, slot * 0.6);

  const move = (e: React.MouseEvent, lines: string[]) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, lines });
  };

  return (
    <div ref={ref} className="relative" style={{ minHeight: height }}>
      {width > 0 && (
        <svg width={width} height={chartH + 24} className="text-foreground">
          <line x1={0} y1={chartH} x2={width} y2={chartH} className="stroke-current" opacity={0.15} />
          {groups.map((g, i) => {
            const cx = i * slot + slot / 2;
            let y = chartH;
            const tot = totalOf(g);
            return (
              <g
                key={g.key}
                className={cn(onSelect && "cursor-pointer")}
                onMouseMove={(e) =>
                  move(e, [
                    g.label,
                    ...series.map((s) => `${s.name}: ${format(g.values[s.name] || 0)}`),
                    `Total: ${format(tot)}`,
                  ])
                }
                onMouseLeave={() => setTip(null)}
                onClick={() => onSelect?.(g.key)}
              >
                {series.map((s) => {
                  const v = g.values[s.name] || 0;
                  const h = (v / max) * (chartH - pad);
                  y -= h;
                  return <rect key={s.name} x={cx - barW / 2} y={y} width={barW} height={Math.max(0, h)} fill={s.color} />;
                })}
                <text x={cx} y={chartH + 16} textAnchor="middle" className="fill-current text-[0.7rem]" opacity={0.75}>
                  {g.label.length > 12 ? `${g.label.slice(0, 11)}…` : g.label}
                </text>
              </g>
            );
          })}
        </svg>
      )}
      <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {series.map((s) => (
          <span key={s.name} className="inline-flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm" style={{ background: s.color }} />
            {s.name}
          </span>
        ))}
      </div>
      <Tooltip tip={tip} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Line
// ---------------------------------------------------------------------------

export interface LinePoint {
  label: string;
  value: number;
}

export function LineChart({
  points,
  height,
  format,
  color = CHART_COLORS[0],
}: {
  points: LinePoint[];
  height: number;
  format: (n: number) => string;
  color?: string;
}) {
  const { ref, width } = useMeasure();
  const [tip, setTip] = useState<Tip>(null);
  const padL = 44;
  const padR = 12;
  const padB = 22;
  const padT = 10;
  const chartH = height - padB - padT;
  const max = Math.max(1, ...points.map((p) => p.value));
  const innerW = Math.max(10, width - padL - padR);
  const stepX = points.length > 1 ? innerW / (points.length - 1) : 0;
  const x = (i: number) => padL + i * stepX;
  const y = (v: number) => padT + chartH - (v / max) * chartH;

  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i)},${y(p.value)}`).join(" ");
  const area = points.length
    ? `${line} L${x(points.length - 1)},${padT + chartH} L${x(0)},${padT + chartH} Z`
    : "";

  const move = (e: React.MouseEvent, lines: string[]) => {
    const rect = ref.current?.getBoundingClientRect();
    if (!rect) return;
    setTip({ x: e.clientX - rect.left + 12, y: e.clientY - rect.top + 12, lines });
  };

  const ticks = [0, max / 2, max];

  return (
    <div ref={ref} className="relative" style={{ minHeight: height }}>
      {width > 0 && (
        <svg width={width} height={height} className="text-foreground">
          {ticks.map((t, i) => (
            <g key={i}>
              <line x1={padL} y1={y(t)} x2={width - padR} y2={y(t)} className="stroke-current" opacity={0.1} />
              <text x={padL - 6} y={y(t)} textAnchor="end" dominantBaseline="middle" className="fill-current text-[0.6rem]" opacity={0.55}>
                {compactNumber(t)}
              </text>
            </g>
          ))}
          {area && <path d={area} fill={color} opacity={0.08} />}
          <path d={line} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(p.value)} r={3} fill={color} />
              <rect
                x={x(i) - stepX / 2}
                y={padT}
                width={Math.max(6, stepX)}
                height={chartH}
                fill="transparent"
                onMouseMove={(e) => move(e, [p.label, format(p.value)])}
                onMouseLeave={() => setTip(null)}
              />
              {(points.length <= 12 || i % 2 === 0) && (
                <text x={x(i)} y={height - 6} textAnchor="middle" className="fill-current text-[0.6rem]" opacity={0.6}>
                  {p.label}
                </text>
              )}
            </g>
          ))}
        </svg>
      )}
      <Tooltip tip={tip} />
    </div>
  );
}

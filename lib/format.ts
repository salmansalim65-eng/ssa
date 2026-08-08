// Shared display formatters so monetary amounts, quantities and dates read
// consistently across every ERP screen. Business/accounting logic never calls
// these — they are presentation-only.

/** Money with thousands separators and exactly two decimals, e.g. 1,250,000.00. */
export function formatMoney(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0.00";
  return n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** A plain number with thousands separators (no forced decimals). */
export function formatNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

/** ISO date (YYYY-MM-DD) rendered as e.g. 08 Aug 2026; passes through anything else. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, y, m, d] = match;
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const monthIndex = Number(m) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${d} ${months[monthIndex]} ${y}`;
}

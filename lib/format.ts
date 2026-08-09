// Shared display formatters so monetary amounts, quantities and dates read
// consistently across every ERP screen. Business/accounting logic never calls
// these — they are presentation-only.

/**
 * Money for display: thousands separators, no decimal places (e.g. 1,250,001).
 * Rounded to the nearest whole unit for presentation only — stored values keep
 * full precision and accounting logic never calls this. Exchange rates are the
 * deliberate exception and are formatted with `formatRate`, not this.
 */
export function formatMoney(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return Math.round(n).toLocaleString(undefined, { maximumFractionDigits: 0 });
}

/** A plain number with thousands separators (no forced decimals). */
export function formatNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

/**
 * Exchange rate for display: keeps up to 4 decimal places without forcing
 * trailing zeros (1, 1.25, 3.6725). Exchange rates are exempt from the
 * whole-number money rule.
 */
export function formatRate(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

/** ISO date (YYYY-MM-DD) rendered as DD-MM-YYYY (e.g. 08-08-2026); passes through anything else. */
export function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, y, m, d] = match;
  const monthIndex = Number(m) - 1;
  if (monthIndex < 0 || monthIndex > 11) return value;
  return `${d}-${m}-${y}`;
}

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

/**
 * Account/ledger codes for display: strips the leading zero-padding so a code
 * like `0000000014` reads as `14` (and `0000000218` as `218`). A code that is
 * all zeros collapses to a single `0`, and any non-numeric code is passed
 * through unchanged. Presentation-only — stored codes keep their padding.
 */
export function formatAccountCode(value: string | null | undefined): string {
  if (value == null) return "";
  const code = String(value).trim();
  if (!code) return "";
  // Only touch purely-numeric codes; leave structured codes (e.g. "10-200") alone.
  if (!/^\d+$/.test(code)) return code;
  return code.replace(/^0+(?=\d)/, "");
}

/**
 * Voucher/document numbers for display: strips the zero-padding from the numeric
 * run so `URI-000023` reads as `URI-23`, `RCT-000008` as `RCT-8`, and a bare
 * `0000000014` as `14`. Any prefix and separators are preserved. Presentation-
 * only — stored numbers keep their padding.
 */
export function formatVoucherNo(value: string | null | undefined): string {
  if (value == null) return "";
  const s = String(value).trim();
  if (!s) return "";
  return s.replace(/(^|[^0-9])0+(\d)/g, "$1$2");
}

/** A plain number with thousands separators (no forced decimals). */
export function formatNumber(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString();
}

/**
 * Currency-conversion factor for display: keeps up to 6 decimal places without
 * forcing trailing zeros (1, 1.25, 3.6725, 0.012987). Matches the 6-dp precision
 * the conversion inputs and numeric(18,6) columns store, so displayed factors
 * are never rounded away.
 */
export function formatRate(value: number | null | undefined): string {
  const n = Number(value ?? 0);
  if (!Number.isFinite(n)) return "0";
  return n.toLocaleString(undefined, { maximumFractionDigits: 6 });
}

/**
 * Any date rendered as DD-MM-YYYY (e.g. 08-08-2026). Accepts ISO date/timestamp
 * strings (`2026-09-20`, `2026-09-20T10:00:00Z`) and Date objects; passes any
 * other string through unchanged and renders null/undefined as an em dash. This
 * is the single source of truth for on-screen date formatting.
 */
export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const iso = value instanceof Date ? value.toISOString() : value;
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) return typeof value === "string" ? value : "—";
  const [, y, m, d] = match;
  const monthIndex = Number(m) - 1;
  if (monthIndex < 0 || monthIndex > 11) return iso;
  return `${d}-${m}-${y}`;
}

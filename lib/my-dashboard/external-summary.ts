import "server-only";

import { z } from "zod";

/**
 * Figures from the OTHER systems on My Dashboard — MBL, RMI and VISTA.
 *
 * Those figures live in their own databases, which SSA cannot read. The
 * tempting fix is to put each app's Supabase service-role key in SSA's
 * environment, but that key bypasses row security: SSA would hold full read
 * AND write access to another company's whole database in order to show four
 * numbers. Far too large a door for the room behind it.
 *
 * So each app publishes its own small, signed, read-only summary endpoint and
 * SSA asks it. What SSA holds is a URL and a bearer token that can do exactly
 * one thing — read those numbers. If a token leaks, the loss is the numbers.
 *
 * The contract is deliberately a LIST of figures rather than named fields:
 * when MBL adds a figure, MBL ships it and the card grows. SSA does not have
 * to be redeployed to learn a new number's name.
 *
 * See `docs/07-my-dashboard-external-summary.md` for the endpoint contract and
 * a route the other apps can copy.
 */
export interface ExternalApp {
  /** Matches the tile's short code on My Dashboard. */
  key: string;
  label: string;
  urlEnv: string;
  tokenEnv: string;
}

export const EXTERNAL_APPS: ExternalApp[] = [
  { key: "MBL", label: "MBL", urlEnv: "MBL_SUMMARY_URL", tokenEnv: "MBL_SUMMARY_TOKEN" },
  { key: "RMI", label: "RMI", urlEnv: "RMI_SUMMARY_URL", tokenEnv: "RMI_SUMMARY_TOKEN" },
  { key: "VISTA", label: "VISTA", urlEnv: "VISTA_SUMMARY_URL", tokenEnv: "VISTA_SUMMARY_TOKEN" },
];

export interface ExternalFigure {
  label: string;
  /** A currency code, or null for a plain count. */
  currency: string | null;
  amount: number;
}

export interface ExternalSummary {
  key: string;
  label: string;
  figures: ExternalFigure[];
  asOf: string | null;
  /** A short, token-free reason the figures are missing. */
  error: string | null;
}

/**
 * The shape SSA accepts. Everything optional is optional on purpose: an app
 * that has only a total should not have to invent an `asOf` to be read.
 */
const payloadSchema = z.object({
  asOf: z.string().max(40).optional(),
  figures: z
    .array(
      z.object({
        label: z.string().min(1).max(40),
        currency: z.string().max(8).nullish(),
        amount: z.number().finite(),
      }),
    )
    // A card with twenty figures on it is a report, and not one SSA asked for.
    .max(8),
});

/** Only the apps someone has actually set up. The rest get no card. */
export function configuredExternalApps(): ExternalApp[] {
  return EXTERNAL_APPS.filter((a) => (process.env[a.urlEnv] ?? "").trim() !== "");
}

/**
 * Ask one app for its summary.
 *
 * Never throws and never resolves to nothing: an app that is down gets a card
 * saying so. Silence would be indistinguishable from a figure of zero, and
 * from the env var having been mistyped.
 */
export async function fetchExternalSummary(app: ExternalApp): Promise<ExternalSummary> {
  const base = { key: app.key, label: app.label, figures: [] as ExternalFigure[], asOf: null };
  const url = (process.env[app.urlEnv] ?? "").trim();
  const token = (process.env[app.tokenEnv] ?? "").trim();

  if (!url) return { ...base, error: `${app.urlEnv} is not set.` };
  // The token travels in a header, so the connection has to be encrypted.
  if (!url.startsWith("https://")) return { ...base, error: `${app.urlEnv} must be an https:// URL.` };
  if (!token) return { ...base, error: `${app.tokenEnv} is not set.` };

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      // Five minutes: these are headline figures, not a ledger, and this way a
      // dashboard opened ten times an hour does not hammer the other app.
      next: { revalidate: 300 },
      // A slow neighbour must not hold this page open.
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) {
      const reason =
        response.status === 401 || response.status === 403
          ? "the token was rejected"
          : response.status === 404
            ? "the endpoint was not found"
            : `it answered ${response.status}`;
      return { ...base, error: `${app.label} did not answer — ${reason}.` };
    }

    const parsed = payloadSchema.safeParse(await response.json());
    if (!parsed.success) return { ...base, error: `${app.label} answered in an unexpected shape.` };

    return {
      key: app.key,
      label: app.label,
      asOf: parsed.data.asOf ?? null,
      figures: parsed.data.figures.map((f) => ({
        label: f.label,
        // Codes only — this is rendered next to a number, not as free text.
        currency: (f.currency ?? "").replace(/[^A-Za-z0-9]/g, "").slice(0, 6) || null,
        amount: f.amount,
      })),
      error: null,
    };
  } catch (error) {
    // Deliberately not the thrown message: a fetch error can quote the request,
    // and the request carries the token.
    const timedOut = error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
    return { ...base, error: timedOut ? `${app.label} did not answer in time.` : `${app.label} could not be reached.` };
  }
}

/** Every configured app at once — one slow app delays only itself. */
export async function fetchExternalSummaries(): Promise<ExternalSummary[]> {
  return Promise.all(configuredExternalApps().map(fetchExternalSummary));
}

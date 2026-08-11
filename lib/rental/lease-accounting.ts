// Pure accounting math for lease-invoice posting. Kept separate from the server
// actions so the rounding rules can be unit-tested and reused by UAE, HH and PK
// generation without duplicating the arithmetic.

/** Round to the currency's decimal places (2 by default), avoiding fp drift. */
export function roundTo(n: number, dp = 2): number {
  const factor = 10 ** dp;
  return Math.round((n + Number.EPSILON) * factor) / factor;
}

// The agent (SAMAD RENT) share is a percentage of the rent; the remainder is
// rental income. Rounding the share and subtracting guarantees
// `share + income === rent` exactly, so the journal always balances.
export const UAE_AGENT_PCT = 0.05; // UAE lease: 5% to SAMAD RENT
export const HH_AGENT_PCT = 0.1; //  HH lease: 10% to SAMAD RENT

export function agentRentSplit(rent: number, pct: number, dp = 2): { share: number; income: number } {
  const share = roundTo(rent * pct, dp);
  return { share, income: roundTo(rent - share, dp) };
}

// Pakistan provision for income tax on rent: 10% of the OFFICIAL rent (not the
// monthly/billed rent) for the period the invoice covers. `periodMonths` scales
// the monthly official rent to the invoiced period (1 for a monthly invoice).
export const PK_INCOME_TAX_PCT = 0.1;

export function pkIncomeTaxProvision(officialRent: number, periodMonths = 1, dp = 2): number {
  if (!officialRent || officialRent <= 0) return 0;
  return roundTo(officialRent * periodMonths * PK_INCOME_TAX_PCT, dp);
}

export interface LedgerAmounts {
  debit_amount: number;
  credit_amount: number;
}

/**
 * Running balance for a sequence of ledger lines, in document order.
 * Shared by the General Ledger report and the Cash/Bank Book (both are
 * "opening balance + a running total per line") rather than each keeping
 * its own copy of the same reduce.
 */
export function computeRunningBalances<T extends LedgerAmounts>(
  openingBalance: number,
  isDebitNormal: boolean,
  lines: T[],
): (T & { balance: number })[] {
  return lines.reduce<(T & { balance: number })[]>((acc, line) => {
    const previousBalance = acc.length > 0 ? acc[acc.length - 1].balance : openingBalance;
    const delta = isDebitNormal
      ? line.debit_amount - line.credit_amount
      : line.credit_amount - line.debit_amount;
    return [...acc, { ...line, balance: previousBalance + delta }];
  }, []);
}

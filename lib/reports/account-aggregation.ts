export interface LedgerLineForAggregation {
  account_id: string;
  account_code: string;
  account_name: string;
  account_type: string;
  debit_amount: number;
  credit_amount: number;
}

export interface AccountTotals {
  account_code: string;
  account_name: string;
  account_type: string;
  debit: number;
  credit: number;
}

/** Sums debit/credit per account out of a flat list of ledger lines. Shared by Trial Balance and Balance Sheet. */
export function aggregateByAccount(lines: LedgerLineForAggregation[]): Map<string, AccountTotals> {
  const byAccount = new Map<string, AccountTotals>();
  for (const l of lines) {
    const existing = byAccount.get(l.account_id) ?? {
      account_code: l.account_code,
      account_name: l.account_name,
      account_type: l.account_type,
      debit: 0,
      credit: 0,
    };
    existing.debit += l.debit_amount;
    existing.credit += l.credit_amount;
    byAccount.set(l.account_id, existing);
  }
  return byAccount;
}

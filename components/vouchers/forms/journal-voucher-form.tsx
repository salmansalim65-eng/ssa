"use client";

import { type AccountOption } from "@/components/vouchers/account-combobox";
import { type CurrencyOption } from "@/components/vouchers/currency-select";
import { JournalGridForm, type CostCenterOption } from "./journal-grid-form";
import { createJournalVoucher, updateJournalVoucher } from "@/features/accounting/vouchers/journal/actions";
import { type JournalVoucherFormValues } from "@/features/accounting/vouchers/journal/schemas";

export function JournalVoucherForm(props: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  voucherId?: string;
  initialValues?: JournalVoucherFormValues;
}) {
  return (
    <JournalGridForm
      {...props}
      voucherType="journal_voucher"
      showHeaderExtras
      createLabel="Create journal voucher"
      onCreate={createJournalVoucher}
      onUpdate={updateJournalVoucher}
    />
  );
}

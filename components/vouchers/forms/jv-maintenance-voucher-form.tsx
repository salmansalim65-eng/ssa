"use client";

import { type AccountOption } from "@/components/vouchers/account-combobox";
import { type CurrencyOption } from "@/components/vouchers/currency-select";
import { JournalGridForm, type CostCenterOption } from "./journal-grid-form";
import {
  createJvMaintenanceVoucher,
  updateJvMaintenanceVoucher,
} from "@/features/accounting/vouchers/jv-maintenance/actions";
import { type JvMaintenanceVoucherFormValues } from "@/features/accounting/vouchers/jv-maintenance/schemas";

export function JvMaintenanceVoucherForm(props: {
  accounts: AccountOption[];
  currencies: CurrencyOption[];
  costCenters: CostCenterOption[];
  voucherId?: string;
  initialValues?: JvMaintenanceVoucherFormValues;
}) {
  return (
    <JournalGridForm
      {...props}
      voucherType="jv_maintenance_voucher"
      createLabel="Create JV maintenance voucher"
      onCreate={createJvMaintenanceVoucher}
      onUpdate={updateJvMaintenanceVoucher}
    />
  );
}

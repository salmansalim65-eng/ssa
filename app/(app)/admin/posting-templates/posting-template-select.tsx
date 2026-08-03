"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { AccountSelect, type AccountOption } from "@/components/vouchers/account-select";
import { setPostingTemplateAccount } from "@/features/accounting/posting-templates/actions";
import type { VoucherType } from "@/types/database.types";

export function PostingTemplateSelect({
  voucherType,
  accountRole,
  debitOrCredit,
  accounts,
  defaultAccountId,
}: {
  voucherType: VoucherType;
  accountRole: string;
  debitOrCredit: "debit" | "credit";
  accounts: AccountOption[];
  defaultAccountId?: string;
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <AccountSelect
      accounts={accounts}
      value={defaultAccountId}
      onValueChange={(accountId) =>
        startTransition(async () => {
          const result = await setPostingTemplateAccount(voucherType, accountRole, debitOrCredit, accountId);
          if (result?.error) toast.error(result.error);
          else toast.success("Saved");
        })
      }
      placeholder={isPending ? "Saving…" : "Select an account"}
    />
  );
}

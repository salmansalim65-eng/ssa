"use server";

import { revalidatePath } from "next/cache";

import { requirePermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { createJournalEntry, getCurrentCompanyId, postVoucher } from "@/lib/vouchers/engine";
import { purchaseVoucherSchema, type PurchaseVoucherInput } from "./schemas";

async function getPostingAccount(companyId: string, accountRole: string) {
  const supabase = await createClient();
  const { data, error } = await supabase.schema("accounting").rpc("fn_get_posting_account", {
    p_company_id: companyId,
    p_voucher_type: "purchase_voucher",
    p_account_role: accountRole,
  });
  if (error) throw new Error(error.message);
  return data as string | null;
}

export async function createPurchaseVoucher(input: PurchaseVoucherInput) {
  const parsed = purchaseVoucherSchema.safeParse(input);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  await requirePermission("purchase_voucher", "create");
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  const createdBy = user.user!.id;

  const [fixedAssetAccountId, supplierPayableAccountId] = await Promise.all([
    getPostingAccount(companyId, "fixed_asset_property"),
    getPostingAccount(companyId, "supplier_payable"),
  ]);
  if (!fixedAssetAccountId || !supplierPayableAccountId) {
    return { error: "Configure Posting Templates for Purchase Voucher first (Fixed Asset + Supplier Payable accounts)." };
  }

  const { data: costCenter } = await supabase
    .schema("accounting")
    .from("cost_centers")
    .select("id")
    .eq("asset_id", parsed.data.assetId)
    .maybeSingle();

  const total =
    parsed.data.purchasePrice + parsed.data.taxes + parsed.data.registrationCharges + parsed.data.additionalExpenses;
  const voucherId = crypto.randomUUID();

  const je = await createJournalEntry({
    companyId,
    voucherType: "purchase_voucher",
    voucherId,
    entryDate: parsed.data.purchaseDate,
    currencyId: parsed.data.currencyId,
    narration: "Property purchase",
    createdBy,
    lines: [
      {
        accountId: fixedAssetAccountId,
        costCenterId: costCenter?.id ?? null,
        debit: total,
        credit: 0,
        description: "Property purchase",
      },
      { accountId: supplierPayableAccountId, debit: 0, credit: total, description: "Property purchase" },
    ],
  });
  if ("error" in je) return { error: je.error };

  const { error } = await supabase.schema("accounting").from("purchase_vouchers").insert({
    id: voucherId,
    company_id: companyId,
    journal_entry_id: je.journalEntryId,
    asset_id: parsed.data.assetId,
    supplier_id: parsed.data.supplierId,
    purchase_date: parsed.data.purchaseDate,
    currency_id: parsed.data.currencyId,
    exchange_rate: je.exchangeRate,
    purchase_price: parsed.data.purchasePrice,
    taxes: parsed.data.taxes,
    registration_charges: parsed.data.registrationCharges,
    additional_expenses: parsed.data.additionalExpenses,
    created_by: createdBy,
  });
  if (error) return { error: error.message };

  revalidatePath("/purchases");
  return { success: true, id: voucherId };
}

export async function postPurchaseVoucher(id: string, journalEntryId: string) {
  await requirePermission("purchase_voucher", "post");
  const companyId = await getCurrentCompanyId();

  const result = await postVoucher({ companyId, voucherType: "purchase_voucher", journalEntryId });
  if ("error" in result) return result;

  const supabase = await createClient();
  const { data: voucher, error: updateError } = await supabase
    .schema("accounting")
    .from("purchase_vouchers")
    .update({ voucher_no: result.voucherNo })
    .eq("id", id)
    .select("asset_id, total_amount")
    .single();
  if (updateError || !voucher) return { error: updateError?.message ?? "Failed to update voucher" };

  await supabase
    .schema("assets")
    .from("assets")
    .update({ purchase_value: voucher.total_amount, current_value: voucher.total_amount })
    .eq("id", voucher.asset_id);

  revalidatePath("/purchases");
  revalidatePath(`/assets/${voucher.asset_id}`);
  return { success: true, voucherNo: result.voucherNo };
}

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { POSTING_TEMPLATE_ROLES } from "@/lib/vouchers/posting-templates";
import { VOUCHER_TYPE_LABELS } from "@/lib/vouchers/meta";
import { PostingTemplateSelect } from "./posting-template-select";

export default async function PostingTemplatesPage() {
  const supabase = await createClient();

  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const [{ data: accounts }, { data: templates }, canEdit] = await Promise.all([
    supabase
      .schema("accounting")
      .from("chart_of_accounts")
      .select("id, account_code, account_name")
      .eq("company_id", companyId)
      .eq("is_group", false)
      .eq("is_active", true)
      .is("deleted_at", null)
      .order("account_code"),
    supabase
      .schema("accounting")
      .from("posting_templates")
      .select("voucher_type, account_role, account_id")
      .eq("company_id", companyId),
    hasPermission("posting_templates", "edit"),
  ]);

  const templateByKey = new Map((templates ?? []).map((t) => [`${t.voucher_type}:${t.account_role}`, t.account_id]));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Posting Templates</h1>
        <p className="text-sm text-muted-foreground">
          For voucher types whose accounting treatment never changes
          transaction-to-transaction, map each role to a Chart of Accounts
          entry once here instead of picking it every time.
        </p>
      </div>

      {Object.entries(POSTING_TEMPLATE_ROLES).map(([voucherType, roles]) => (
        <Card key={voucherType}>
          <CardHeader>
            <CardTitle>{VOUCHER_TYPE_LABELS[voucherType as keyof typeof VOUCHER_TYPE_LABELS]}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {roles?.map((r) => (
              <div key={r.role} className="flex items-center gap-3">
                <Badge variant="outline" className="w-20 justify-center capitalize">
                  {r.side}
                </Badge>
                <span className="w-48 shrink-0 text-sm">{r.label}</span>
                {canEdit ? (
                  <PostingTemplateSelect
                    voucherType={voucherType as keyof typeof VOUCHER_TYPE_LABELS}
                    accountRole={r.role}
                    debitOrCredit={r.side}
                    accounts={accounts ?? []}
                    defaultAccountId={templateByKey.get(`${voucherType}:${r.role}`)}
                  />
                ) : (
                  <span className="text-sm text-muted-foreground">
                    {accounts?.find((a) => a.id === templateByKey.get(`${voucherType}:${r.role}`))?.account_name ??
                      "Not configured"}
                  </span>
                )}
              </div>
            ))}
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

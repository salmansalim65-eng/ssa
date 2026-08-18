import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { hasPermission } from "@/lib/auth/permissions";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CompanyEditForm } from "./company-edit-form";

export default async function CompaniesPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .schema("core")
    .from("user_profiles")
    .select("default_company_id")
    .eq("id", user.id)
    .single();

  const { data: company } = await supabase
    .schema("core")
    .from("companies")
    .select("id, name, code, country, address, accounting_period_start")
    .eq("id", profile!.default_company_id!)
    .single();

  const canEdit = await hasPermission("companies", "edit");

  if (!company) {
    return <p className="text-sm text-muted-foreground">Company not found.</p>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Administration"
        title="Company"
        description={`Company code ${company.code} — code is fixed at creation time.`}
      />
      <Card>
        <CardHeader>
          <CardTitle>Company details</CardTitle>
          <CardDescription>
            Visible to every user in this company; only Company: Edit can change it.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyEditForm
            companyId={company.id}
            canEdit={canEdit}
            defaultValues={{
              name: company.name,
              country: (company.country as "PK" | "AE") ?? "PK",
              address: company.address ?? "",
              accountingPeriodStart: company.accounting_period_start ?? "",
            }}
          />
        </CardContent>
      </Card>
    </div>
  );
}

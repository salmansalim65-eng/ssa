import { redirect } from "next/navigation";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { requireUser } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { CompanyForm } from "./company-form";

export default async function OnboardingPage() {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: profile } = await supabase
    .schema("core")
    .from("user_profiles")
    .select("default_company_id")
    .eq("id", user.id)
    .single();

  if (profile?.default_company_id) {
    redirect("/dashboard");
  }

  return (
    <div className="flex flex-1 items-center justify-center bg-muted/40 p-6">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>Set up your company</CardTitle>
          <CardDescription>
            You&apos;ll be the Administrator for this company and can invite more
            users afterwards.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm />
        </CardContent>
      </Card>
    </div>
  );
}

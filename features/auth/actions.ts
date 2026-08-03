"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import {
  bootstrapCompanySchema,
  loginSchema,
  requestPasswordResetSchema,
  type BootstrapCompanyInput,
  type LoginInput,
  type RequestPasswordResetInput,
} from "./schemas";

export async function signIn(input: LoginInput) {
  const parsed = loginSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);
  if (error) return { error: error.message };

  redirect("/dashboard");
}

export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/login");
}

export async function requestPasswordReset(input: RequestPasswordResetInput) {
  const parsed = requestPasswordResetSchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email);
  if (error) return { error: error.message };

  return { success: true };
}

export async function bootstrapCompany(input: BootstrapCompanyInput) {
  const parsed = bootstrapCompanySchema.safeParse(input);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const supabase = await createClient();
  const { error } = await supabase.schema("core").rpc("fn_bootstrap_company", {
    p_company_name: parsed.data.companyName,
    p_company_code: parsed.data.companyCode,
    p_country: parsed.data.country,
  });

  if (error) return { error: error.message };

  revalidatePath("/dashboard");
  redirect("/dashboard");
}

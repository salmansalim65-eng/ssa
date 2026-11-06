"use server";

import { revalidatePath } from "next/cache";

import { createClient } from "@/lib/supabase/server";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

/**
 * Registers (or refreshes) the browser's push subscription for this device.
 * Keyed on the endpoint, so re-subscribing the same device replaces its keys
 * rather than piling up rows.
 */
export async function savePushSubscription(input: {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string;
}) {
  const supabase = await createClient();
  const { data: user } = await supabase.auth.getUser();
  if (!user.user) return { error: "Not signed in" };

  const companyId = await getCurrentCompanyId();
  const { error } = await supabase
    .schema("core")
    .from("push_subscriptions")
    .upsert(
      {
        user_id: user.user.id,
        company_id: companyId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        user_agent: input.userAgent ?? null,
      },
      { onConflict: "endpoint" },
    );

  if (error) return { error: error.message };
  return { success: true };
}

/** Forgets this device — used when the user turns alerts off. */
export async function removePushSubscription(endpoint: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("push_subscriptions")
    .delete()
    .eq("endpoint", endpoint);

  if (error) return { error: error.message };
  return { success: true };
}

/**
 * Marks an alert read. Scoped to the signed-in reader by the row policy, so a
 * stray id marks nothing rather than somebody else's.
 */
export async function markAlertRead(id: string) {
  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { success: true };
}

/** Marks every unread alert of this reader, in this company, read. */
export async function markAllAlertsRead() {
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();
  const { error } = await supabase
    .schema("core")
    .from("alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("company_id", companyId)
    .is("read_at", null);
  if (error) return { error: error.message };
  revalidatePath("/notifications");
  return { success: true };
}

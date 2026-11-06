import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { sendPushToUsers } from "./push";

/**
 * An alert: something somebody should KNOW about, as against something they
 * must act on.
 *
 * Approvals already had a channel — a voucher sits pending and the bell counts
 * it, so the work itself is the reminder. Nothing had a channel for "this
 * happened, no action needed". A push alone is not one: a push is lost if the
 * browser was never given permission, if the phone was off, or if nobody
 * looked. So an alert is a ROW first, which survives being missed, and a push
 * second, which is only how it reaches a phone that is listening.
 *
 * One row per recipient, because "read" belongs to a person, not to an event.
 *
 * Written with the service role: an alert is raised FOR other people, by
 * whoever happened to trigger it, and no user-scoped row policy can express
 * that. The recipients are decided here, in server code, never by the caller's
 * own permissions.
 */
export interface AlertInput {
  companyId: string;
  /** Who to tell. Empty is not an error — there may be nobody to tell. */
  userIds: string[];
  /** What happened, as a key: 'receipt_voucher', 'payment_voucher'... */
  kind: string;
  title: string;
  body?: string;
  /** Where it happened, so the alert is a way in and not only a notice. */
  url?: string;
}

/**
 * Raises an alert. Never throws and never fails its caller: a receipt that
 * posted is posted whether or not anybody got told about it, and losing the
 * posting because the alert failed would be the worse bargain by far.
 */
export async function raiseAlert(input: AlertInput) {
  const recipients = [...new Set(input.userIds.filter(Boolean))];
  if (recipients.length === 0) return;

  try {
    const supabase = createAdminClient();
    await supabase
      .schema("core")
      .from("alerts")
      .insert(
        recipients.map((userId) => ({
          company_id: input.companyId,
          user_id: userId,
          kind: input.kind,
          title: input.title,
          body: input.body ?? null,
          url: input.url ?? null,
        })),
      );

    await sendPushToUsers(recipients, {
      title: input.title,
      body: input.body ?? "",
      url: input.url ?? "/notifications",
      // One notification per event, replaced rather than stacked.
      tag: `${input.kind}-${input.url ?? input.title}`,
    });
  } catch {
    // Best-effort by design — see above.
  }
}

/** The administrators of a company, minus `exceptUserId`. */
export async function adminUserIds(companyId: string, exceptUserId?: string) {
  try {
    const supabase = createAdminClient();
    const { data } = await supabase.schema("core").rpc("fn_admin_user_ids", { p_company_id: companyId });
    return ((data ?? []) as { user_id: string }[])
      .map((r) => r.user_id)
      .filter((id) => id && id !== exceptUserId);
  } catch {
    return [];
  }
}

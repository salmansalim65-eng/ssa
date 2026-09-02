import "server-only";

import webpush from "web-push";

import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Web push, used to tell an approver on their phone that a voucher is waiting —
 * the app does not have to be open.
 *
 * The whole feature is optional: with no VAPID keys configured every call here
 * is a no-op, so the app runs exactly as before until the two environment
 * variables are set.
 */
const publicKey = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY ?? "";
const privateKey = process.env.VAPID_PRIVATE_KEY ?? "";
const subject = process.env.VAPID_SUBJECT || "mailto:no-reply@ssa-erp.app";

export function isPushConfigured() {
  return Boolean(publicKey && privateKey);
}

let configured = false;
function ensureConfigured() {
  if (configured) return;
  webpush.setVapidDetails(subject, publicKey, privateKey);
  configured = true;
}

export interface PushMessage {
  title: string;
  body: string;
  /** Where tapping the notification takes the user. */
  url: string;
  /** Notifications sharing a tag replace one another instead of stacking up. */
  tag?: string;
}

/**
 * Sends one message to every device the given users have registered, in
 * parallel. A device the push service reports as gone (404/410 — browser data
 * cleared, app uninstalled) is deleted so it is not retried forever; any other
 * failure is swallowed, because a notification must never take down the action
 * that triggered it.
 */
export async function sendPushToUsers(userIds: string[], message: PushMessage) {
  if (!isPushConfigured() || userIds.length === 0) return;

  const supabase = createAdminClient();
  const { data: subscriptions } = await supabase
    .schema("core")
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .in("user_id", userIds);

  if (!subscriptions?.length) return;
  ensureConfigured();

  const payload = JSON.stringify(message);
  const stale: string[] = [];

  await Promise.all(
    subscriptions.map(async (s) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: s.endpoint as string,
            keys: { p256dh: s.p256dh as string, auth: s.auth as string },
          },
          payload,
        );
      } catch (error) {
        const status = (error as { statusCode?: number })?.statusCode;
        if (status === 404 || status === 410) stale.push(s.id as string);
      }
    }),
  );

  if (stale.length) {
    await supabase.schema("core").from("push_subscriptions").delete().in("id", stale);
  }
}

/** The users who may approve `moduleKey` in this company, minus `exceptUserId`. */
export async function approverUserIds(companyId: string, moduleKey: string, exceptUserId?: string) {
  const supabase = createAdminClient();
  const { data } = await supabase
    .schema("core")
    .rpc("fn_approver_user_ids", { p_company_id: companyId, p_module_key: moduleKey });
  return ((data ?? []) as { user_id: string }[])
    .map((r) => r.user_id)
    .filter((id) => id && id !== exceptUserId);
}

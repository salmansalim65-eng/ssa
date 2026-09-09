import { NextResponse } from "next/server";

import { createAdminClient } from "@/lib/supabase/admin";
import { isPushConfigured, sendPushToUsers } from "@/lib/notifications/push";
import { DUE_SOON_DAYS, loadLeaseRenewals, renewalsNeedingAttention } from "@/lib/rental/renewals";

export const dynamic = "force-dynamic";

/**
 * The daily lease-renewal alert.
 *
 * The dashboard panel and the header bell only speak to someone who has the app
 * open. This is the other half: once a day it looks at every company's running
 * contracts and pushes a notification to the people allowed to see rent, so a
 * contract reaching its renewal date is heard about ON that date.
 *
 * It is a scheduled job, not a user route — it runs with the service role and is
 * therefore locked to the scheduler's shared secret. With no CRON_SECRET set the
 * endpoint refuses everything rather than exposing lease data, and with no VAPID
 * keys it reports what it WOULD have sent and delivers nothing (the same
 * "optional feature" stance the rest of push takes).
 *
 * Schedule lives in vercel.json.
 */
export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createAdminClient();
  const { data: companies } = await supabase.schema("core").from("companies").select("id, name");

  const summary: { company: string; due: number; overdue: number; recipients: number }[] = [];

  for (const company of companies ?? []) {
    const companyId = company.id as string;
    const rows = renewalsNeedingAttention(await loadLeaseRenewals(supabase, companyId));
    if (rows.length === 0) continue;

    const overdue = rows.filter((r) => r.status === "overdue");
    // Everyone allowed to see either country's rent — a renewal is rent news.
    const recipients = new Set<string>();
    for (const moduleKey of ["uae_rent_invoice", "pk_rent_invoice"]) {
      const { data } = await supabase
        .schema("core")
        .rpc("fn_users_with_permission", { p_company_id: companyId, p_module_key: moduleKey, p_action: "view" });
      for (const r of (data ?? []) as { user_id: string }[]) if (r.user_id) recipients.add(r.user_id);
    }

    const headline =
      overdue.length > 0
        ? `${overdue.length} contract${overdue.length === 1 ? "" : "s"} past renewal`
        : `${rows.length} contract${rows.length === 1 ? "" : "s"} due within ${DUE_SOON_DAYS} days`;
    const body = rows
      .slice(0, 4)
      .map((r) => `${r.property}: ${r.status === "overdue" ? `overdue ${-(r.daysLeft ?? 0)}d` : `${r.daysLeft ?? 0}d left`}`)
      .join(" · ");

    await sendPushToUsers([...recipients], {
      title: `Lease renewals — ${headline}`,
      body: rows.length > 4 ? `${body} · +${rows.length - 4} more` : body,
      url: "/dashboard",
      // One standing renewal notification per device: today's replaces
      // yesterday's rather than piling up.
      tag: "lease-renewals",
    });

    summary.push({
      company: (company.name as string) ?? companyId,
      due: rows.length,
      overdue: overdue.length,
      recipients: recipients.size,
    });
  }

  return NextResponse.json({ pushConfigured: isPushConfigured(), companies: summary });
}

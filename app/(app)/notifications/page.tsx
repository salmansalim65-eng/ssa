import Link from "next/link";

import { PageHeader } from "@/components/ui/page-header";
import { createClient } from "@/lib/supabase/server";
import { formatDate } from "@/lib/format";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";
import { isMissingTable } from "@/lib/my-dashboard/notes-availability";
import { cn } from "@/lib/utils";
import { MarkAllRead } from "./mark-all-read";

/**
 * Alerts: what happened, as against what is waiting to be decided.
 *
 * Approvals have the register; this is for everything that needs no decision
 * and would otherwise only be found by opening a screen and noticing. Unread
 * ones are marked, and an alert that names a document is a link to it, so the
 * list is a way in rather than only a notice board.
 *
 * The rows are whoever is reading's own — the row policy says so, not this
 * query — so there is nothing here to gate on a permission.
 */
export default async function NotificationsPage() {
  const companyId = await getCurrentCompanyId();
  const supabase = await createClient();

  const { data, error } = await supabase
    .schema("core")
    .from("alerts")
    .select("id, kind, title, body, url, created_at, read_at")
    .eq("company_id", companyId)
    .order("created_at", { ascending: false })
    .limit(200);

  // Alerts arrive with migration 0143; until it runs, say which one rather
  // than failing the page.
  const unavailable = isMissingTable(error)
    ? "Alerts need migration 0143_alerts_and_receipt_without_approval.sql to be run on the database first."
    : (error?.message ?? null);

  const rows = (data ?? []) as {
    id: string;
    kind: string;
    title: string;
    body: string | null;
    url: string | null;
    created_at: string;
    read_at: string | null;
  }[];
  const unread = rows.filter((r) => !r.read_at).length;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Alerts"
        title="Notifications"
        description="Things that happened and nobody has to approve — receipts taken, and whatever else SSA is told to pass on."
        backHref="/dashboard"
      />

      {unavailable ? (
        <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">{unavailable}</p>
      ) : rows.length === 0 ? (
        <p className="rounded-lg border border-dashed bg-card p-4 text-sm text-muted-foreground">
          Nothing yet.
        </p>
      ) : (
        <div className="space-y-3">
          {unread > 0 && (
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                <span className="font-medium text-foreground">{unread}</span> unread
              </p>
              <MarkAllRead />
            </div>
          )}
          <ul className="divide-y rounded-xl border bg-card shadow-xs">
            {rows.map((r) => {
              const body = (
                <>
                  <div className="flex items-baseline justify-between gap-3">
                    <p className={cn("text-sm", r.read_at ? "text-foreground" : "font-semibold text-foreground")}>
                      {!r.read_at && (
                        <span className="mr-2 inline-block size-2 rounded-full bg-destructive align-middle" aria-label="Unread" />
                      )}
                      {r.title}
                    </p>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                      {formatDate(r.created_at.slice(0, 10))}
                    </span>
                  </div>
                  {r.body && <p className="mt-0.5 text-sm text-muted-foreground">{r.body}</p>}
                </>
              );
              return (
                <li key={r.id} className={cn("px-4 py-3", !r.read_at && "bg-primary/[0.03]")}>
                  {r.url ? (
                    <Link href={r.url} className="block rounded-sm hover:underline">
                      {body}
                    </Link>
                  ) : (
                    body
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

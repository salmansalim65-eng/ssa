import { Suspense } from "react";

import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadLeaseRenewals, renewalsNeedingAttention } from "@/lib/rental/renewals";
import { AlertsBell } from "./alerts-bell";
import { AppBadge } from "./app-badge";
import { ApprovalsBell } from "./approvals-bell";
import { RenewalsBell } from "./renewals-bell";

/**
 * The header bells, streamed rather than awaited.
 *
 * All three are counts: vouchers waiting for a decision, leases at or past
 * renewal, and alerts — things that happened and were not read yet. Neither is what anyone opened the page for, yet they used to be
 * fetched in the layout — so every single navigation, on every screen, waited
 * on a scan of the leases and the assets before a byte of the page could be
 * sent. Behind a Suspense boundary the page renders immediately and the bells
 * arrive when they arrive.
 *
 * Each side is also fetched only when the reader may see it: a role with no
 * approvals access no longer counts approvals, and one with no rental access no
 * longer loads a single lease.
 */
export function HeaderBells({ companyId }: { companyId: string }) {
  return (
    <Suspense fallback={null}>
      <Bells companyId={companyId} />
    </Suspense>
  );
}

async function Bells({ companyId }: { companyId: string }) {
  const [canSeeApprovals, canSeeUaeRent, canSeePkRent] = await Promise.all([
    hasPermission("approval_workflows", "view"),
    hasPermission("uae_rent_invoice", "view"),
    hasPermission("pk_rent_invoice", "view"),
  ]);
  const canSeeRent = canSeeUaeRent || canSeePkRent;

  const supabase = await createClient();
  const [approvals, renewals, alerts] = await Promise.all([
    // Counted off the vouchers themselves, not off the approval records.
    //
    // Those are two different books, and they disagree: the register showed
    // "Pending approval 1" while the bell, reading voucher_approvals, showed
    // nothing — so the one person who had to act on it had no sign it existed.
    // A voucher's own status is what the register filters on and what the bell
    // links to, so it is what the bell now counts. One source, one answer.
    canSeeApprovals
      ? supabase
          .schema("accounting")
          .from("journal_entries")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("status", "pending")
      : Promise.resolve({ count: null }),
    canSeeRent ? loadLeaseRenewals(supabase, companyId) : Promise.resolve([]),
    // Everyone's own unread alerts. No permission gates it: the row policy
    // already limits these to the reader's own, and an alert nobody may see is
    // an alert that was never raised for them.
    supabase
      .schema("core")
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("company_id", companyId)
      .is("read_at", null),
  ]);

  const due = canSeeRent ? renewalsNeedingAttention(renewals) : [];
  // Alerts arrive with 0143; before that migration runs the table is not there
  // and the count comes back null, which reads as "none" rather than taking
  // the header down with it.
  const unread = alerts.count ?? 0;
  const waiting = (canSeeApprovals ? approvals.count ?? 0 : 0) + due.length + unread;

  return (
    <>
      {/* The same total on the installed app's icon, so the dock or home screen
          says what the header says without the app being open. */}
      <AppBadge count={waiting} />
      {canSeeApprovals && <ApprovalsBell count={approvals.count ?? 0} />}
      {unread > 0 && <AlertsBell count={unread} />}
      {canSeeRent && (
        <RenewalsBell count={due.length} overdue={due.filter((r) => r.status === "overdue").length} />
      )}
    </>
  );
}

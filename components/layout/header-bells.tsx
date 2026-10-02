import { Suspense } from "react";

import { hasPermission } from "@/lib/auth/permissions";
import { createClient } from "@/lib/supabase/server";
import { loadLeaseRenewals, renewalsNeedingAttention } from "@/lib/rental/renewals";
import { ApprovalsBell } from "./approvals-bell";
import { RenewalsBell } from "./renewals-bell";

/**
 * The two header bells, streamed rather than awaited.
 *
 * Both are counts: vouchers waiting for a decision, and leases at or past
 * renewal. Neither is what anyone opened the page for, yet they used to be
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
  if (!canSeeApprovals && !canSeeRent) return null;

  const supabase = await createClient();
  const [approvals, renewals] = await Promise.all([
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
  ]);

  const due = canSeeRent ? renewalsNeedingAttention(renewals) : [];

  return (
    <>
      {canSeeApprovals && <ApprovalsBell count={approvals.count ?? 0} />}
      {canSeeRent && (
        <RenewalsBell count={due.length} overdue={due.filter((r) => r.status === "overdue").length} />
      )}
    </>
  );
}

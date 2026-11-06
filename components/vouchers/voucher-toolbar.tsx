import { Suspense } from "react";
import Link from "next/link";
import { ListIcon, PlusIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getVoucherListRows } from "@/lib/vouchers/queries";
import type { Phase5VoucherType } from "@/lib/vouchers/meta";
import { VoucherBrowse } from "./voucher-browse";

/** How many the Browse dialog holds. Everything older is one link away. */
const BROWSE_LIMIT = 150;

/**
 * The bar above every voucher: Browse, New, Register.
 *
 * The menu opens a blank voucher now rather than a list, because making one is
 * what people come to do. That moves the burden onto finding an OLD one, so
 * every voucher screen carries the way back: Browse opens the recent ones in
 * place, New starts another, and Register is the full list with its filters,
 * totals and export.
 *
 * Streamed, because none of it is what the screen is for. Loading the browse
 * rows alongside the form would make every new voucher wait on a list nobody
 * has asked to see yet; behind a Suspense boundary the form paints at once and
 * the button fills in a moment later, in the space it already holds.
 */
export function VoucherToolbar({
  voucherType,
  companyId,
  canCreate,
}: {
  voucherType: Phase5VoucherType;
  companyId: string;
  canCreate: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-2 print:hidden">
      <Suspense fallback={<BrowsePlaceholder />}>
        <BrowseSlot voucherType={voucherType} companyId={companyId} />
      </Suspense>
      {canCreate && (
        <Button asChild variant="outline" size="sm">
          <Link href={`/accounting/vouchers/${voucherType}/new`}>
            <PlusIcon /> New
          </Link>
        </Button>
      )}
      <Button asChild variant="ghost" size="sm">
        <Link href={`/accounting/vouchers/${voucherType}`}>
          <ListIcon /> Register
        </Link>
      </Button>
    </div>
  );
}

async function BrowseSlot({
  voucherType,
  companyId,
}: {
  voucherType: Phase5VoucherType;
  companyId: string;
}) {
  const rows = await getVoucherListRows(companyId, voucherType);
  return (
    <VoucherBrowse voucherType={voucherType} rows={rows.slice(0, BROWSE_LIMIT)} total={rows.length} />
  );
}

/** Holds the button's width while the rows load, so the bar does not jump. */
function BrowsePlaceholder() {
  return <div className="h-8 w-[5.5rem] rounded-md border bg-muted/40" aria-hidden />;
}

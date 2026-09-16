import { Suspense } from "react";
import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { getRecordNeighbours, VOUCHER_TABLES, type VoucherNeighbour } from "@/lib/vouchers/pager";
import type { Phase5VoucherType } from "@/lib/vouchers/meta";

/**
 * Step to the voucher before or after this one without going back to the list.
 *
 * The order is the register's own — newest first — so Previous is the row above
 * this voucher and Next the row below it. Each button carries the number it
 * leads to, so it says where it goes rather than only which way; at either end
 * of the list the button stays in place, disabled, so the pair never shifts
 * position as it is clicked along.
 */
export function VoucherPager({
  basePath,
  prev,
  next,
}: {
  /** Where a neighbour lives: `${basePath}/${id}`. */
  basePath: string;
  prev: VoucherNeighbour | null;
  next: VoucherNeighbour | null;
}) {
  const href = (n: VoucherNeighbour) => `${basePath}/${n.id}`;
  return (
    <div className="flex items-center gap-1 print:hidden">
      {prev ? (
        <Button asChild variant="outline" size="sm" title={`Previous voucher — ${prev.voucherNo ?? "draft"}`}>
          <Link href={href(prev)}>
            <ChevronLeftIcon /> <span className="hidden sm:inline">{prev.voucherNo ?? "Previous"}</span>
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled title="This is the newest one">
          <ChevronLeftIcon /> <span className="hidden sm:inline">Previous</span>
        </Button>
      )}
      {next ? (
        <Button asChild variant="outline" size="sm" title={`Next voucher — ${next.voucherNo ?? "draft"}`}>
          <Link href={href(next)}>
            <span className="hidden sm:inline">{next.voucherNo ?? "Next"}</span> <ChevronRightIcon />
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled title="This is the oldest one">
          <span className="hidden sm:inline">Next</span> <ChevronRightIcon />
        </Button>
      )}
    </div>
  );
}

/**
 * The pager, fetched on its own rather than with the voucher.
 *
 * Finding the neighbours costs a lookup of this voucher's timestamp and then a
 * row either side of it — three round trips that the document itself does not
 * need. Awaited alongside the voucher they delayed every open by that much;
 * behind a Suspense boundary the voucher paints first and the two buttons
 * appear a moment later, in the space they already occupy.
 */
export function VoucherPagerSlot({
  basePath,
  voucherType,
  companyId,
  id,
}: {
  basePath: string;
  voucherType: Phase5VoucherType;
  companyId: string;
  id: string;
}) {
  return (
    <Suspense fallback={<PagerPlaceholder />}>
      <LoadedPager basePath={basePath} voucherType={voucherType} companyId={companyId} id={id} />
    </Suspense>
  );
}

async function LoadedPager({
  basePath,
  voucherType,
  companyId,
  id,
}: {
  basePath: string;
  voucherType: Phase5VoucherType;
  companyId: string;
  id: string;
}) {
  const { prev, next } = await getRecordNeighbours(
    "accounting",
    VOUCHER_TABLES[voucherType],
    companyId,
    id,
  );
  return <VoucherPager basePath={basePath} prev={prev} next={next} />;
}

/** Holds the pager's width while it loads, so nothing shifts when it lands. */
function PagerPlaceholder() {
  return (
    <div className="flex items-center gap-1 print:hidden" aria-hidden>
      <div className="h-8 w-[4.5rem] rounded-md border bg-muted/40" />
      <div className="h-8 w-[4.5rem] rounded-md border bg-muted/40" />
    </div>
  );
}

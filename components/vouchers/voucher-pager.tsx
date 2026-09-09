import Link from "next/link";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import type { VoucherNeighbour } from "@/lib/vouchers/pager";

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

import Link from "next/link";

import { cn } from "@/lib/utils";

// Journal Voucher and JV Service Charges (voucher_type `jv_maintenance_voucher`,
// kept stable for data + permissions) are presented as two tabs of one area.
const TABS = [
  { type: "journal_voucher", label: "Journal Voucher" },
  { type: "jv_maintenance_voucher", label: "JV Service Charges" },
] as const;

export function isJournalTabType(voucherType: string) {
  return TABS.some((t) => t.type === voucherType);
}

export function VoucherTypeTabs({ active, mode }: { active: string; mode: "list" | "new" }) {
  return (
    <div className="flex gap-1 border-b">
      {TABS.map((t) => {
        const href = mode === "new" ? `/accounting/vouchers/${t.type}/new` : `/accounting/vouchers/${t.type}`;
        const isActive = t.type === active;
        return (
          <Link
            key={t.type}
            href={href}
            aria-current={isActive ? "page" : undefined}
            className={cn(
              "-mb-px border-b-2 px-4 py-2 text-sm font-medium transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-muted-foreground hover:border-border hover:text-foreground",
            )}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

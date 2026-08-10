"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

/**
 * Search / status / date filters for the unified Rent Invoices page. Every
 * control writes to a query param (preserving the active `type` tab) so the
 * server component re-filters the unified invoice view.
 */
export function RentInvoiceFilters({
  defaultQuery,
  defaultStatus,
  defaultFrom,
  defaultTo,
}: {
  defaultQuery: string;
  defaultStatus: string;
  defaultFrom: string;
  defaultTo: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const [q, setQ] = useState(defaultQuery);
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);

  function push(mutate: (p: URLSearchParams) => void) {
    const params = new URLSearchParams(searchParams.toString());
    mutate(params);
    router.push(`${pathname}?${params.toString()}`);
  }

  function apply() {
    push((p) => {
      if (q.trim()) p.set("q", q.trim());
      else p.delete("q");
      if (from) p.set("from", from);
      else p.delete("from");
      if (to) p.set("to", to);
      else p.delete("to");
    });
  }

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="w-64 space-y-1">
        <Label htmlFor="inv-q">Search</Label>
        <Input
          id="inv-q"
          placeholder="Invoice no, tenant or property…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && apply()}
        />
      </div>
      <div className="w-40 space-y-1">
        <Label>Status</Label>
        <Select
          value={defaultStatus || ALL}
          onValueChange={(v) => push((p) => (v && v !== ALL ? p.set("status", v) : p.delete("status")))}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={ALL}>All statuses</SelectItem>
            <SelectItem value="draft">Draft</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="posted">Posted</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="space-y-1">
        <Label htmlFor="inv-from">From</Label>
        <Input id="inv-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
      </div>
      <div className="space-y-1">
        <Label htmlFor="inv-to">To</Label>
        <Input id="inv-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
      </div>
      <Button size="sm" onClick={apply}>
        Apply
      </Button>
    </div>
  );
}

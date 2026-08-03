"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function AsOfDateFilter({ defaultAsOf }: { defaultAsOf: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [asOf, setAsOf] = useState(defaultAsOf);

  function apply() {
    const params = new URLSearchParams(searchParams.toString());
    params.set("asOf", asOf);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <div className="flex flex-wrap items-end gap-3 print:hidden">
      <div className="space-y-1">
        <Label htmlFor="report-as-of">As of</Label>
        <Input id="report-as-of" type="date" value={asOf} onChange={(e) => setAsOf(e.target.value)} />
      </div>
      <Button size="sm" onClick={apply}>
        Apply
      </Button>
    </div>
  );
}

"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { setBaseCurrency, setCompanyCurrencyActive } from "@/features/admin/currencies/actions";

export interface CurrencyRow {
  id: string;
  code: string;
  name: string;
  symbol: string;
  decimal_places: number;
  isEnabled: boolean;
  isBase: boolean;
}

export function CurrenciesTable({ rows, canEdit }: { rows: CurrencyRow[]; canEdit: boolean }) {
  const [isPending, startTransition] = useTransition();

  function toggleActive(currencyId: string, checked: boolean) {
    startTransition(async () => {
      const result = await setCompanyCurrencyActive(currencyId, checked);
      if (result?.error) toast.error(result.error);
    });
  }

  function makeBase(currencyId: string) {
    startTransition(async () => {
      const result = await setBaseCurrency(currencyId);
      if (result?.error) toast.error(result.error);
      else toast.success("Base currency updated");
    });
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Code</TableHead>
          <TableHead>Name</TableHead>
          <TableHead>Symbol</TableHead>
          <TableHead>Decimals</TableHead>
          <TableHead>Enabled for this company</TableHead>
          <TableHead>Base currency</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={row.id}>
            <TableCell className="font-mono font-medium">{row.code}</TableCell>
            <TableCell>{row.name}</TableCell>
            <TableCell>{row.symbol}</TableCell>
            <TableCell>{row.decimal_places}</TableCell>
            <TableCell>
              <Checkbox
                checked={row.isEnabled}
                disabled={!canEdit || row.isBase || isPending}
                onCheckedChange={(checked) => toggleActive(row.id, checked === true)}
              />
            </TableCell>
            <TableCell>
              {row.isBase ? (
                <Badge>Base currency</Badge>
              ) : (
                canEdit && (
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPending}
                    onClick={() => makeBase(row.id)}
                  >
                    Set as base
                  </Button>
                )
              )}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

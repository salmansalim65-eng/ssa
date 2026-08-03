"use client";

import { useState, useTransition } from "react";
import { Trash2Icon } from "lucide-react";
import { toast } from "sonner";

import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { deleteWorkflowStep, setWorkflowActive } from "@/features/accounting/approval-workflows/actions";
import { VOUCHER_TYPE_LABELS, type VoucherType } from "@/lib/vouchers/meta";
import { AddStepForm } from "./add-step-form";

export interface StepRow {
  id: string;
  stepOrder: number;
  roleName: string;
  minAmount: number | null;
  maxAmount: number | null;
}

export interface WorkflowInfo {
  isActive: boolean;
  steps: StepRow[];
}

export function ApprovalWorkflowsManager({
  voucherTypes,
  workflowByVoucherType,
  roles,
  canEdit,
  canDelete,
}: {
  voucherTypes: VoucherType[];
  workflowByVoucherType: Record<string, WorkflowInfo>;
  roles: { id: string; name: string }[];
  canEdit: boolean;
  canDelete: boolean;
}) {
  const [active, setActive] = useState(voucherTypes[0]);
  const [isPending, startTransition] = useTransition();

  return (
    <Tabs value={active} onValueChange={(v) => setActive(v as VoucherType)}>
      <TabsList className="h-auto flex-wrap justify-start">
        {voucherTypes.map((vt) => (
          <TabsTrigger key={vt} value={vt}>
            {VOUCHER_TYPE_LABELS[vt]}
          </TabsTrigger>
        ))}
      </TabsList>

      {voucherTypes.map((vt) => {
        const info = workflowByVoucherType[vt] ?? { isActive: false, steps: [] };
        return (
          <TabsContent key={vt} value={vt} className="space-y-4">
            <div className="flex items-center gap-2">
              <Checkbox
                id={`active-${vt}`}
                checked={info.isActive}
                disabled={!canEdit || isPending}
                onCheckedChange={(checked) =>
                  startTransition(async () => {
                    const result = await setWorkflowActive(vt, checked === true);
                    if (result?.error) toast.error(result.error);
                  })
                }
              />
              <Label htmlFor={`active-${vt}`}>
                Require approval for {VOUCHER_TYPE_LABELS[vt]}
              </Label>
            </div>

            {info.isActive && (
              <>
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Step</TableHead>
                      <TableHead>Approver role</TableHead>
                      <TableHead>Min amount</TableHead>
                      <TableHead>Max amount</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {info.steps.map((step) => (
                      <TableRow key={step.id}>
                        <TableCell>{step.stepOrder}</TableCell>
                        <TableCell>{step.roleName}</TableCell>
                        <TableCell>{step.minAmount ?? "—"}</TableCell>
                        <TableCell>{step.maxAmount ?? "—"}</TableCell>
                        <TableCell>
                          {canDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              disabled={isPending}
                              onClick={() =>
                                startTransition(async () => {
                                  const result = await deleteWorkflowStep(step.id);
                                  if (result?.error) toast.error(result.error);
                                  else toast.success("Step removed");
                                })
                              }
                            >
                              <Trash2Icon className="size-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                    {info.steps.length === 0 && (
                      <TableRow>
                        <TableCell colSpan={5} className="text-center text-muted-foreground">
                          No steps yet — every voucher will auto-approve until you add one.
                        </TableCell>
                      </TableRow>
                    )}
                  </TableBody>
                </Table>

                {canEdit && <AddStepForm voucherType={vt} roles={roles} />}
              </>
            )}
          </TabsContent>
        );
      })}
    </Tabs>
  );
}

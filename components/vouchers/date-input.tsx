"use client";

import * as React from "react";

import { Input } from "@/components/ui/input";

/**
 * A native date field that opens the calendar picker when the field is clicked
 * or focused (not just the small calendar icon), via the browser's
 * HTMLInputElement.showPicker().
 */
export function DateInput(props: React.ComponentProps<typeof Input>) {
  function openPicker(e: React.SyntheticEvent<HTMLInputElement>) {
    const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void };
    try {
      el.showPicker?.();
    } catch {
      // showPicker throws if not triggered by a user gesture or unsupported —
      // the native icon still works as a fallback.
    }
  }

  return <Input type="date" {...props} onClick={openPicker} onFocus={openPicker} />;
}

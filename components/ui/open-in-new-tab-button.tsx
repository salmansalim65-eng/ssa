"use client";

import { ExternalLinkIcon } from "lucide-react";

import { Button } from "@/components/ui/button";

// Opens the current page (same URL, including its filters in the query string)
// in a new browser tab, so the user can keep this report/voucher open while
// navigating to another.
export function OpenInNewTabButton() {
  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      className="print:hidden"
      title="Open this page in a new browser tab"
      onClick={() => window.open(window.location.href, "_blank", "noopener,noreferrer")}
    >
      <ExternalLinkIcon className="size-4" />
      New tab
    </Button>
  );
}

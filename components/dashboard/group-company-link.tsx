"use client";

import { useState } from "react";
import { ExternalLinkIcon } from "lucide-react";

/**
 * A clickable link to a sister-company ERP hosted at its own URL. Shows the
 * company logo when one is available, falling back to the company name if the
 * image is missing or fails to load. Opens in a new tab.
 */
export function GroupCompanyLink({
  href,
  name,
  logoSrc,
}: {
  href: string;
  name: string;
  /** Public path or absolute URL of the company logo. Omit to show the name. */
  logoSrc?: string;
}) {
  const [imgOk, setImgOk] = useState(Boolean(logoSrc));

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      title={`Open ${name} ERP`}
      className="inline-flex items-center gap-2 rounded-lg border border-ledger/30 bg-ledger/10 px-4 py-2 shadow-xs transition hover:bg-ledger/20"
    >
      {logoSrc && imgOk ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={logoSrc}
          alt={`${name} logo`}
          className="h-8 w-auto object-contain"
          onError={() => setImgOk(false)}
        />
      ) : (
        <span className="text-sm font-semibold uppercase tracking-wide text-ledger-dark">{name}</span>
      )}
      <ExternalLinkIcon className="size-4 shrink-0 text-ledger-dark opacity-70" />
    </a>
  );
}

// Route-level loading UI. Without this, Next.js keeps the previous page fully
// visible while the next server component fetches its data — so clicking a new
// report/voucher looks like "the last one is still open". This Suspense
// fallback swaps the content out instantly on navigation.
export default function Loading() {
  return (
    <div className="flex min-h-[60vh] items-center justify-center">
      <div className="flex flex-col items-center gap-3 text-muted-foreground">
        <span
          className="size-8 animate-spin rounded-full border-2 border-ledger/30 border-t-ledger-dark"
          aria-hidden
        />
        <span className="text-sm font-medium">Loading…</span>
      </div>
    </div>
  );
}

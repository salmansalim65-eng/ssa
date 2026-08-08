import Image from "next/image";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen flex-1 items-center justify-center bg-muted/40 p-6">
      <div className="w-full max-w-sm space-y-6">
        <div className="flex flex-col items-center gap-3 text-center">
          <span className="flex size-12 items-center justify-center rounded-xl bg-header shadow-sm">
            <Image src="/logo.svg" alt="SSA logo" width={30} height={30} className="size-7" priority />
          </span>
          <div className="space-y-0.5">
            <p className="text-base font-semibold tracking-tight text-foreground">Rental &amp; Accounting ERP</p>
            <p className="text-xs uppercase tracking-wider text-muted-foreground">
              Enterprise Finance Suite
            </p>
          </div>
        </div>
        {children}
      </div>
    </div>
  );
}

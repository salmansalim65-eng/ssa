import { CashBankBookView } from "@/components/reports/cash-bank-book-view";
import { getCashOrBankBookSections } from "@/lib/reports/cash-bank-book";
import { createClient } from "@/lib/supabase/server";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function CashBookPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string }>;
}) {
  const { from = startOfYear(), to = today() } = await searchParams;

  const supabase = await createClient();
  const { data: companyIdData } = await supabase.schema("core").rpc("current_company_id");
  const companyId = companyIdData as string;

  const sections = await getCashOrBankBookSections({ companyId, flag: "is_cash", from, to });

  return (
    <CashBankBookView
      title="Cash Book"
      description="Every account flagged as cash, with a running balance."
      sections={sections}
      from={from}
      to={to}
      filenamePrefix="cash-book"
    />
  );
}

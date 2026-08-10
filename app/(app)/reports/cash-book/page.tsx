import { CashBankBookView } from "@/components/reports/cash-bank-book-view";
import { getCashOrBankBookSections } from "@/lib/reports/cash-bank-book";
import { loadReportCountries } from "@/lib/reports/countries";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

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
  searchParams: Promise<{ from?: string; to?: string; country?: string }>;
}) {
  const { from = startOfYear(), to = today(), country = "" } = await searchParams;

  const companyId = await getCurrentCompanyId();

  const [sections, countries] = await Promise.all([
    getCashOrBankBookSections({ companyId, flag: "is_cash", from, to, country }),
    loadReportCountries(companyId),
  ]);

  return (
    <CashBankBookView
      title="Cash Book"
      description="Every account flagged as cash, with a running balance."
      sections={sections}
      from={from}
      to={to}
      filenamePrefix="cash-book"
      countries={countries}
      country={country}
    />
  );
}

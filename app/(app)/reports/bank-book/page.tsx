import { CashBankBookView } from "@/components/reports/cash-bank-book-view";
import { getCashOrBankBookSections } from "@/lib/reports/cash-bank-book";
import { loadReportCountries } from "@/lib/reports/countries";
import { loadAccountingPeriodStart } from "@/lib/reports/period";
import { resolveReportCurrency } from "@/lib/reports/report-currency";
import { getCurrentCompanyId } from "@/lib/vouchers/engine";

function startOfYear() {
  const now = new Date();
  return `${now.getFullYear()}-01-01`;
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

export default async function BankBookPage({
  searchParams,
}: {
  searchParams: Promise<{ from?: string; to?: string; country?: string; cur?: string }>;
}) {
  const { from: spFrom, to = today(), country = "", cur = "" } = await searchParams;

  const companyId = await getCurrentCompanyId();
  const periodStart = await loadAccountingPeriodStart(companyId);
  const from = spFrom ?? periodStart ?? startOfYear();

  const [sections, countries, currency] = await Promise.all([
    getCashOrBankBookSections({ companyId, flag: "is_bank", from, to, country }),
    loadReportCountries(companyId),
    resolveReportCurrency(companyId, cur, to),
  ]);

  return (
    <CashBankBookView
      title="Bank Book"
      description="Every account flagged as bank, with a running balance."
      sections={sections}
      from={from}
      to={to}
      filenamePrefix="bank-book"
      countries={countries}
      country={country}
      currency={currency}
      selectedCurrency={cur}
    />
  );
}

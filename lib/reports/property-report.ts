// Property Report calculations. Every column in the report is derived here from
// asset + lease data so the maths lives in one tested place.
//
// Verified against the reference report:
//   Monthly Rent     = gross lease rent − Commission − HH expenses  (NET; service charges NOT deducted)
//   Yearly Rent      = Monthly Rent × 12
//   Diff Est/Yearly  = Est Rent × 12 − Yearly Rent      (annualised estimate vs actual)
//   Sq Ft Value      = Purchase Value / Sq Ft
//   Service Charges  = Service Rate × Sq Ft             (stored on the asset; = "Maintenance")
//   Perc%            = Monthly Rent × 12 / Current Value × 100    (annualised yield)
//   % Month          = Perc% / 12
//   Difference Value = Current Value − Purchase Value
//   Maintenance%     = Service Charges / Yearly Rent × 100

function round2(n: number): number {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

export type LeaseCycle = "monthly" | "quarterly" | "yearly" | string | null;

/** Normalises a lease amount to a monthly figure using its rent cycle. */
export function monthlyFromCycle(amount: number, cycle: LeaseCycle): number {
  const a = Number(amount) || 0;
  if (cycle === "yearly") return round2(a / 12);
  if (cycle === "quarterly") return round2(a / 3);
  return round2(a); // monthly (default)
}

export interface PropertyRowInput {
  id: string;
  group: string;
  name: string;
  assetCode: string;
  country: string;
  propertyType: string;
  currencyId: string | null;
  currencyCode: string;
  estimatedRentMonthly: number; // asset.estimated_rent (monthly)
  monthlyRent: number; // normalised from the active lease (0 if none)
  areaSqft: number;
  serviceRate: number; // asset.service_charges_rate
  serviceCharges: number; // asset.service_charges_amount (rate × area), ANNUAL
  commissionMonthly: number; // agent commission per month (5% UAE / 10% HH / 0 PK)
  expensesMonthly?: number; // monthly HH lease expenses (0 for UAE/PK leases without them)
  purchaseValue: number;
  currentValue: number;
  titleDeedValue: number;
  titleDeedOwner: string;
  occupied: boolean;
  // Detail-panel extras (pass-through)
  purchaseDate: string | null;
  valuationYear: number | null;
  leaseStart: string | null;
  leaseEnd: string | null;
  renewMonth: string | null;
  titleDeedAttachmentId: string | null;
  titleDeedUrl: string | null;
  imageCount: number;
  images: PropertyImage[];
}

export interface PropertyImage {
  url: string;
  fileName: string;
}

export interface PropertyRow {
  id: string;
  group: string;
  name: string;
  assetCode: string;
  country: string;
  propertyType: string;
  currencyId: string | null;
  currencyCode: string;
  estRent: number;
  monthlyRent: number;
  yearlyRent: number;
  diffEstVsYearly: number;
  sqFt: number;
  sqFtValue: number;
  serviceRate: number;
  serviceCharges: number; // annual (kept for reference)
  serviceMonthly: number; // monthly service charge = serviceCharges / 12
  commission: number; // monthly agent commission
  expensesMonthly: number; // monthly HH lease expenses
  netRent: number; // monthly: monthlyRent − commission − expensesMonthly
  currentValue: number;
  perc: number;
  percMonth: number;
  purchaseValue: number;
  diffValue: number;
  maintenancePct: number;
  titleDeedOwner: string;
  titleDeedValue: number;
  occupied: boolean;
  purchaseDate: string | null;
  valuationYear: number | null;
  leaseStart: string | null;
  leaseEnd: string | null;
  renewMonth: string | null;
  titleDeedAttachmentId: string | null;
  titleDeedUrl: string | null;
  imageCount: number;
  images: PropertyImage[];
}

export function computePropertyRow(i: PropertyRowInput): PropertyRow {
  const estRent = round2(i.estimatedRentMonthly);
  const commission = round2(i.commissionMonthly);
  const expensesMonthly = round2(i.expensesMonthly ?? 0);
  // "Monthly Rent" is the owner's NET monthly rent: gross lease rent less the
  // agent commission and the monthly HH lease expenses. Service charges are shown
  // separately but NOT deducted. Yearly Rent and the yields all follow from it.
  const grossMonthly = round2(i.monthlyRent);
  const monthlyRent = round2(grossMonthly - commission - expensesMonthly);
  const yearlyRent = round2(monthlyRent * 12);
  const diffEstVsYearly = round2(estRent * 12 - yearlyRent);
  const sqFt = round2(i.areaSqft);
  const purchaseValue = round2(i.purchaseValue);
  const currentValue = round2(i.currentValue);
  const serviceCharges = round2(i.serviceCharges); // annual
  const serviceMonthly = round2(serviceCharges / 12);
  // Net Rent equals Monthly Rent now (both net); kept for the yield calc.
  const netRent = monthlyRent;
  return {
    id: i.id,
    group: i.group,
    name: i.name,
    assetCode: i.assetCode,
    country: i.country,
    propertyType: i.propertyType,
    currencyId: i.currencyId,
    currencyCode: i.currencyCode,
    estRent,
    monthlyRent,
    yearlyRent,
    diffEstVsYearly,
    sqFt,
    sqFtValue: sqFt > 0 ? round2(purchaseValue / sqFt) : 0,
    serviceRate: round2(i.serviceRate),
    serviceCharges,
    serviceMonthly,
    commission,
    expensesMonthly,
    netRent,
    currentValue,
    perc: currentValue > 0 ? round2(((netRent * 12) / currentValue) * 100) : 0,
    percMonth: currentValue > 0 ? round2(((netRent * 12) / currentValue) * 100 / 12) : 0,
    purchaseValue,
    diffValue: round2(currentValue - purchaseValue),
    maintenancePct: yearlyRent > 0 ? round2((serviceCharges / yearlyRent) * 100) : 0,
    titleDeedOwner: i.titleDeedOwner,
    titleDeedValue: round2(i.titleDeedValue),
    occupied: i.occupied,
    purchaseDate: i.purchaseDate,
    valuationYear: i.valuationYear,
    leaseStart: i.leaseStart,
    leaseEnd: i.leaseEnd,
    renewMonth: i.renewMonth,
    titleDeedAttachmentId: i.titleDeedAttachmentId,
    titleDeedUrl: i.titleDeedUrl,
    imageCount: i.imageCount,
    images: i.images,
  };
}

export interface PropertyGroupTotals {
  estRent: number;
  monthlyRent: number;
  yearlyRent: number;
  diffEstVsYearly: number;
  sqFt: number;
  sqFtValue: number;
  serviceCharges: number;
  serviceMonthly: number;
  commission: number;
  netRent: number;
  currentValue: number;
  perc: number;
  percMonth: number;
  purchaseValue: number;
  diffValue: number;
  maintenancePct: number;
}

/** Aggregates child rows into a group total: additive columns are summed, ratio
 *  columns are recomputed from the summed figures. */
export function aggregateGroup(rows: PropertyRow[]): PropertyGroupTotals {
  const sum = (pick: (r: PropertyRow) => number) => round2(rows.reduce((s, r) => s + pick(r), 0));
  const estRent = sum((r) => r.estRent);
  const monthlyRent = sum((r) => r.monthlyRent);
  const yearlyRent = sum((r) => r.yearlyRent);
  const sqFt = sum((r) => r.sqFt);
  const serviceCharges = sum((r) => r.serviceCharges);
  const serviceMonthly = sum((r) => r.serviceMonthly);
  const commission = sum((r) => r.commission);
  const netRent = sum((r) => r.netRent);
  const currentValue = sum((r) => r.currentValue);
  const purchaseValue = sum((r) => r.purchaseValue);
  return {
    estRent,
    monthlyRent,
    yearlyRent,
    diffEstVsYearly: sum((r) => r.diffEstVsYearly),
    sqFt,
    sqFtValue: sqFt > 0 ? round2(purchaseValue / sqFt) : 0,
    serviceCharges,
    serviceMonthly,
    commission,
    netRent,
    currentValue,
    perc: currentValue > 0 ? round2(((netRent * 12) / currentValue) * 100) : 0,
    percMonth: currentValue > 0 ? round2(((netRent * 12) / currentValue) * 100 / 12) : 0,
    purchaseValue,
    diffValue: round2(currentValue - purchaseValue),
    maintenancePct: yearlyRent > 0 ? round2((serviceCharges / yearlyRent) * 100) : 0,
  };
}

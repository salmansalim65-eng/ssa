// Property Report calculations. Every column in the report is derived here from
// asset + lease data so the maths lives in one tested place.
//
// Verified against the reference report:
//   Yearly Rent      = Monthly Rent × 12
//   Diff Est/Yearly  = Est Rent × 12 − Yearly Rent      (annualised estimate vs actual)
//   Sq Ft Value      = Purchase Value / Sq Ft
//   Service Charges  = Service Rate × Sq Ft             (stored on the asset)
//   Net Rent         = Yearly Rent − Service Charges
//   Perc%            = Net Rent / Current Value × 100    (yield)
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
  estimatedRentMonthly: number; // asset.estimated_rent (monthly)
  monthlyRent: number; // normalised from the active lease (0 if none)
  areaSqft: number;
  serviceRate: number; // asset.service_charges_rate
  serviceCharges: number; // asset.service_charges_amount (rate × area)
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
  imageCount: number;
}

export interface PropertyRow {
  id: string;
  group: string;
  name: string;
  assetCode: string;
  country: string;
  propertyType: string;
  estRent: number;
  monthlyRent: number;
  yearlyRent: number;
  diffEstVsYearly: number;
  sqFt: number;
  sqFtValue: number;
  serviceRate: number;
  serviceCharges: number;
  netRent: number;
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
  imageCount: number;
}

export function computePropertyRow(i: PropertyRowInput): PropertyRow {
  const estRent = round2(i.estimatedRentMonthly);
  const monthlyRent = round2(i.monthlyRent);
  const yearlyRent = round2(monthlyRent * 12);
  const diffEstVsYearly = round2(estRent * 12 - yearlyRent);
  const sqFt = round2(i.areaSqft);
  const purchaseValue = round2(i.purchaseValue);
  const currentValue = round2(i.currentValue);
  const serviceCharges = round2(i.serviceCharges);
  const netRent = round2(yearlyRent - serviceCharges);
  return {
    id: i.id,
    group: i.group,
    name: i.name,
    assetCode: i.assetCode,
    country: i.country,
    propertyType: i.propertyType,
    estRent,
    monthlyRent,
    yearlyRent,
    diffEstVsYearly,
    sqFt,
    sqFtValue: sqFt > 0 ? round2(purchaseValue / sqFt) : 0,
    serviceRate: round2(i.serviceRate),
    serviceCharges,
    netRent,
    currentValue,
    perc: currentValue > 0 ? round2((netRent / currentValue) * 100) : 0,
    percMonth: currentValue > 0 ? round2((netRent / currentValue) * 100 / 12) : 0,
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
    imageCount: i.imageCount,
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
    netRent,
    currentValue,
    perc: currentValue > 0 ? round2((netRent / currentValue) * 100) : 0,
    percMonth: currentValue > 0 ? round2((netRent / currentValue) * 100 / 12) : 0,
    purchaseValue,
    diffValue: round2(currentValue - purchaseValue),
    maintenancePct: yearlyRent > 0 ? round2((serviceCharges / yearlyRent) * 100) : 0,
  };
}

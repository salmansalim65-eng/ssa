// Area / size measurement units for assets. Stored on assets.area_unit as the
// `code` (e.g. "SQFT"), kept separate from the numeric area so the value can be
// filtered, reported and converted later. Add new units by extending this list —
// nothing else needs to change.

export interface AreaUnit {
  code: string;
  label: string; // full label, e.g. "Sq. Ft."
  /** Factor to convert 1 of this unit into square feet (for optional display). */
  toSqft: number;
}

export const AREA_UNITS: AreaUnit[] = [
  { code: "SQFT", label: "Sq. Ft.", toSqft: 1 },
  { code: "SQM", label: "Sq. Meter", toSqft: 10.7639 },
  { code: "SQYD", label: "Sq. Yard", toSqft: 9 },
  { code: "SQKM", label: "Sq. Kilometer", toSqft: 10763910.4 },
  { code: "ACRE", label: "Acre", toSqft: 43560 },
  { code: "HECTARE", label: "Hectare", toSqft: 107639 },
];

const BY_CODE = new Map(AREA_UNITS.map((u) => [u.code, u] as const));

/** Full label for a unit code, or the raw code if unknown, or "" when unset. */
export function areaUnitLabel(code: string | null | undefined): string {
  if (!code) return "";
  return BY_CODE.get(code)?.label ?? code;
}

/**
 * "5,000 Sq. Ft." — area plus its unit. Returns the number alone when no unit is
 * set (existing assets whose unit is unspecified), and an em dash when no area.
 */
export function formatArea(area: number | null | undefined, unitCode: string | null | undefined): string {
  if (area == null) return "—";
  const num = Number(area).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const label = areaUnitLabel(unitCode);
  return label ? `${num} ${label}` : num;
}

/**
 * Optional equivalent in another unit (defaults to Sq. Meter), e.g. "≈ 464.52
 * Sq. Meter". Returns null when the area/unit is missing or the target equals the
 * source, so callers can simply skip rendering.
 */
export function convertedArea(
  area: number | null | undefined,
  unitCode: string | null | undefined,
  targetCode = "SQM",
): string | null {
  if (area == null || !unitCode) return null;
  const from = BY_CODE.get(unitCode);
  const to = BY_CODE.get(targetCode);
  if (!from || !to || from.code === to.code) return null;
  const inSqft = Number(area) * from.toSqft;
  const converted = inSqft / to.toSqft;
  const num = converted.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return `≈ ${num} ${to.label}`;
}

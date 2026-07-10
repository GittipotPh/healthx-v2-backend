type DecimalLike = { toNumber: () => number };

/**
 * Normalizes Prisma Decimal / string / number money-ish values to a plain
 * number. Nullish and unparseable values become 0.
 */
export function decimalToNumber(value: unknown): number {
  if (value == null) return 0;
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value) || 0;
  if (typeof value === "object" && "toNumber" in value) return (value as DecimalLike).toNumber();
  return Number(value) || 0;
}

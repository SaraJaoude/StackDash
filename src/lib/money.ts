/**
 * Exact decimal arithmetic for provider amounts that arrive as decimal strings or JSON numbers
 * with sub-cent precision (Vercel FOCUS charges, GitHub billing usage).
 *
 * Rounding rule, decided once for the whole app: amounts are summed exactly at full precision
 * and rounded to the currency's minor unit a single time, at the end, using round half to even.
 * Rounding each line item and then the total is how a dashboard ends up a cent away from the
 * provider's invoice.
 */

export type Decimal = Readonly<{ coefficient: bigint; scale: number }>;

export const ROUNDING_MODE = "half-even" as const;

const DECIMAL_PATTERN = /^([+-])?(\d+)(?:\.(\d+))?$/;
const MAX_SCALE = 18;

export class InvalidDecimalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidDecimalError";
  }
}

export function parseDecimal(input: string | number): Decimal {
  let text: string;
  if (typeof input === "number") {
    if (!Number.isFinite(input)) throw new InvalidDecimalError("Amount is not a finite number.");
    // Shortest round-trip representation; exponent notation is expanded below.
    text = expandExponent(String(input));
  } else {
    text = input.trim();
  }
  const match = DECIMAL_PATTERN.exec(text);
  if (match === null) throw new InvalidDecimalError("Amount is not a plain decimal number.");
  const [, sign, whole = "0", fraction = ""] = match;
  if (fraction.length > MAX_SCALE) {
    throw new InvalidDecimalError(`Amount has more than ${MAX_SCALE} decimal places.`);
  }
  const magnitude = BigInt(whole + fraction);
  return { coefficient: sign === "-" ? -magnitude : magnitude, scale: fraction.length };
}

function expandExponent(text: string): string {
  const match = /^(-?)(\d+)(?:\.(\d+))?e([+-]\d+)$/i.exec(text);
  if (match === null) return text;
  const [, sign = "", whole = "", fraction = "", exponentText = "0"] = match;
  const exponent = Number(exponentText);
  const digits = whole + fraction;
  const pointIndex = whole.length + exponent;
  if (pointIndex <= 0) return `${sign}0.${"0".repeat(-pointIndex)}${digits}`;
  if (pointIndex >= digits.length) return `${sign}${digits}${"0".repeat(pointIndex - digits.length)}`;
  return `${sign}${digits.slice(0, pointIndex)}.${digits.slice(pointIndex)}`;
}

function rescale(value: Decimal, scale: number): bigint {
  return value.coefficient * 10n ** BigInt(scale - value.scale);
}

export function addDecimals(values: readonly Decimal[]): Decimal {
  const scale = values.reduce((max, value) => Math.max(max, value.scale), 0);
  const coefficient = values.reduce((sum, value) => sum + rescale(value, scale), 0n);
  return { coefficient, scale };
}

/** Digits after the decimal point for an ISO 4217 code (2 for USD, 0 for JPY, 3 for KWD). */
export function currencyMinorDigits(currency: string): number {
  if (!/^[A-Z]{3}$/.test(currency)) {
    throw new InvalidDecimalError("Currency must be a three-letter ISO 4217 code.");
  }
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).resolvedOptions()
    .maximumFractionDigits ?? 2;
}

/** Rounds once, half to even, to the currency's minor unit. Throws past the safe integer range. */
export function toMinorUnits(value: Decimal, currency: string): number {
  const digits = currencyMinorDigits(currency);
  let minor: bigint;
  if (value.scale <= digits) {
    minor = rescale(value, digits);
  } else {
    const divisor = 10n ** BigInt(value.scale - digits);
    const quotient = value.coefficient / divisor;
    const remainder = value.coefficient % divisor;
    const absRemainderTimesTwo = (remainder < 0n ? -remainder : remainder) * 2n;
    const direction = value.coefficient < 0n ? -1n : 1n;
    if (absRemainderTimesTwo > divisor) minor = quotient + direction;
    else if (absRemainderTimesTwo < divisor) minor = quotient;
    else minor = quotient % 2n === 0n ? quotient : quotient + direction;
  }
  if (minor > BigInt(Number.MAX_SAFE_INTEGER) || minor < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new InvalidDecimalError("Amount is too large to store in minor units.");
  }
  return Number(minor);
}

/** Convenience for one amount: parse, then round once. */
export function decimalToMinorUnits(input: string | number, currency: string): number {
  return toMinorUnits(parseDecimal(input), currency);
}

/**
 * An amount in minor units shared over `divisor` (a positive whole number, such as signups), rounded
 * once to the minor unit, half to even, like every other rounding in the app.
 */
export function divideMinorUnits(amountMinor: number, divisor: number): number {
  if (!Number.isSafeInteger(amountMinor)) throw new InvalidDecimalError("Amount must be a whole number of minor units.");
  if (!Number.isSafeInteger(divisor) || divisor <= 0) throw new InvalidDecimalError("Divisor must be a positive whole number.");
  const amount = BigInt(amountMinor);
  const by = BigInt(divisor);
  const quotient = amount / by;
  const remainder = amount % by;
  const absRemainderTimesTwo = (remainder < 0n ? -remainder : remainder) * 2n;
  const direction = amount < 0n ? -1n : 1n;
  if (absRemainderTimesTwo > by) return Number(quotient + direction);
  if (absRemainderTimesTwo < by) return Number(quotient);
  return Number(quotient % 2n === 0n ? quotient : quotient + direction);
}

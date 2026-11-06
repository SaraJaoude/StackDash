import { describe, expect, it } from "vitest";
import {
  InvalidDecimalError,
  addDecimals,
  currencyMinorDigits,
  decimalToMinorUnits,
  divideMinorUnits,
  multiplyDecimals,
  parseDecimal,
  toMinorUnits,
} from "./money";

describe("decimalToMinorUnits", () => {
  it.each([
    ["whole dollars", "12", "USD", 1200],
    ["exact cents", "12.34", "USD", 1234],
    ["sub-cent rounds down below half", "0.0049", "USD", 0],
    ["half rounds to even (down)", "0.125", "USD", 12],
    ["half rounds to even (up)", "0.135", "USD", 14],
    ["above half rounds up", "0.12500001", "USD", 13],
    ["negative half rounds to even", "-0.125", "USD", -12],
    ["zero-decimal currency", "1500.5", "JPY", 1500],
    ["three-decimal currency", "1.2345", "KWD", 1234],
    ["JSON number input", 0.1, "USD", 10],
    ["exponent number input", 1e-7, "USD", 0],
    ["surrounding whitespace", " 3.10 ", "USD", 310],
  ])("%s", (_name, input, currency, expected) => {
    expect(decimalToMinorUnits(input, currency)).toBe(expected);
  });

  it.each([
    ["empty string", ""],
    ["letters", "1.2a"],
    ["thousands separator", "1,000.00"],
    ["more than 18 decimals", "0.1234567890123456789"],
  ])("rejects %s", (_name, input) => {
    expect(() => decimalToMinorUnits(input, "USD")).toThrow(InvalidDecimalError);
  });

  it("rejects non-finite numbers", () => {
    expect(() => decimalToMinorUnits(Number.NaN, "USD")).toThrow(InvalidDecimalError);
  });

  it("rejects amounts beyond the safe integer range", () => {
    expect(() => decimalToMinorUnits("99999999999999999999", "USD")).toThrow(InvalidDecimalError);
  });

  it("rejects a lowercase currency code", () => {
    expect(() => currencyMinorDigits("usd")).toThrow(InvalidDecimalError);
  });
});

describe("addDecimals rounds once at the end", () => {
  it("three sub-cent line items sum before rounding", () => {
    // Rounding each 0.004 would give 0; the exact sum 0.012 rounds to 1 cent.
    const total = addDecimals(["0.004", "0.004", "0.004"].map((value) => parseDecimal(value)));
    expect(toMinorUnits(total, "USD")).toBe(1);
  });

  it("empty list is zero", () => {
    expect(toMinorUnits(addDecimals([]), "USD")).toBe(0);
  });
});

describe("divideMinorUnits", () => {
  it.each([
    ["exact", 500, 4, 125],
    ["below half rounds down", 500, 3, 167],
    ["half rounds to even, down", 500, 8, 62],
    ["half rounds to even, up", 300, 8, 38],
    ["one share", 41, 1, 41],
    ["zero", 0, 7, 0],
    ["negative half rounds to even", -500, 8, -62],
    ["negative below half", -500, 3, -167],
  ])("%s", (_name, amountMinor, divisor, expected) => {
    expect(divideMinorUnits(amountMinor, divisor)).toBe(expected);
  });

  it.each([
    ["a zero divisor", 100, 0],
    ["a negative divisor", 100, -2],
    ["a fractional divisor", 100, 1.5],
    ["a fractional amount", 10.5, 2],
  ])("rejects %s", (_name, amountMinor, divisor) => {
    expect(() => divideMinorUnits(amountMinor, divisor)).toThrow(InvalidDecimalError);
  });
});

describe("multiplyDecimals is exact until the one rounding", () => {
  it("a quantity times a sub-cent unit price keeps every digit", () => {
    // 43,200 vCPU-minutes at $0.000463 is exactly $20.0016.
    const product = multiplyDecimals(parseDecimal("43200"), parseDecimal("0.000463"));
    expect(product).toEqual({ coefficient: 20001600n, scale: 6 });
    expect(toMinorUnits(product, "USD")).toBe(2000);
  });

  it.each([
    ["zero quantity", "0", "0.000231", 0],
    ["negative times positive", "-2.5", "0.5", -125],
    ["two long fractions past 18 places", "0.000000047683716", "0.000003472222222", 0],
  ])("%s", (_name, a, b, expected) => {
    expect(toMinorUnits(multiplyDecimals(parseDecimal(a), parseDecimal(b)), "USD")).toBe(expected);
  });
});

import { describe, expect, it } from "vitest";
import {
  InvalidDecimalError,
  addDecimals,
  currencyMinorDigits,
  decimalToMinorUnits,
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

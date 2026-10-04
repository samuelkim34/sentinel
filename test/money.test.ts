import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MoneyError, parseUsdToCents, sumCents } from "../src/contracts/money";

describe("money", () => {
  it("parses dollars to cents", () => {
    assert.equal(parseUsdToCents("10.5"), 1050);
    assert.equal(parseUsdToCents(0), 0);
    assert.equal(parseUsdToCents("100000000.00"), 10_000_000_000);
  });

  it("rejects exponents, negatives, extra precision, and non-finite values", () => {
    for (const value of ["1e2", "1.005", "-1", "+1", "", "NaN", Infinity, Number.NaN, "1,000.00"]) {
      assert.throws(() => parseUsdToCents(value), MoneyError);
    }
  });

  it("does not coerce a bad amount to zero", () => {
    assert.throws(() => parseUsdToCents(undefined), MoneyError);
  });

  it("rejects an overflowing total", () => {
    assert.throws(() => sumCents([Number.MAX_SAFE_INTEGER, 1]), MoneyError);
  });
});

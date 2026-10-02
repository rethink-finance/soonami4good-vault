import { describe, expect, it } from "vitest";
import { fmtAmount, fmtBps, fmtRounded, parseAmount, shortAddress } from "./format";

const E = 10n ** 18n;

describe("fmtAmount", () => {
  it("rounds down, never up", () => {
    expect(fmtAmount(1_999_999_999_999_999_999n)).toBe("1.9999");
    expect(fmtAmount(4_999_999_937_500_000_000n)).toBe("4.9999");
  });
  it("drops trailing zeros and groups thousands", () => {
    expect(fmtAmount(10n * E)).toBe("10");
    expect(fmtAmount(1_234_500n * E + E / 2n)).toBe("1,234,500.5");
  });
  it("shows dust as dust", () => {
    expect(fmtAmount(3n)).toBe("<0.0001");
    expect(fmtAmount(0n)).toBe("0");
  });
});

describe("fmtRounded", () => {
  it("rounds to the nearest shown digit", () => {
    expect(fmtRounded(1_999_999_998_000_000_000n)).toBe("2");
    expect(fmtRounded(1_499_940_000_000_000_000n)).toBe("1.4999");
    expect(fmtRounded(1_499_960_000_000_000_000n)).toBe("1.5");
    expect(fmtRounded(0n)).toBe("0");
    expect(fmtRounded(3n)).toBe("0");
  });
});

describe("parseAmount", () => {
  it("reads decimals with a dot or a comma", () => {
    expect(parseAmount("1.5")).toBe((3n * E) / 2n);
    expect(parseAmount("0,25")).toBe(E / 4n);
    expect(parseAmount(".5")).toBe(E / 2n);
    expect(parseAmount("2.")).toBe(2n * E);
  });
  it("rejects what is not an amount", () => {
    for (const text of ["", ".", "abc", "-1", "1e18", "1.2.3", "0x10", "1." + "1".repeat(19)]) {
      expect(parseAmount(text), text).toBeUndefined();
    }
  });
});

describe("small helpers", () => {
  it("formats basis points and addresses", () => {
    expect(fmtBps(25n)).toBe("0.25%");
    expect(shortAddress("0x2741408077cd7C7D3943D0142bafAE28c97EAA35")).toBe("0x2741…AA35");
  });
});

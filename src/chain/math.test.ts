import { describe, expect, it } from "vitest";
import { isSettleable, sharePrice, sharesForDeposit, valueForRedemption } from "./math";

const E = 10n ** 18n;
const empty = { totalNav: 0n, totalSupply: 0n, depositFeeBps: 0n, withdrawFeeBps: 0n };

describe("sharesForDeposit", () => {
  it("mints 1:1 into an empty vault", () => {
    expect(sharesForDeposit(10n * E, empty)).toBe(10n * E);
  });

  it("gives the first depositor whatever value was already in the vault", () => {
    // supply == 0 mints totalNAV + amount: the reason test money is cleared before opening.
    expect(sharesForDeposit(E, { ...empty, totalNav: 5n })).toBe(E + 5n);
  });

  it("stays within parts per billion of 1:1 at a 1:1 share price, never above", () => {
    const vault = { ...empty, totalNav: 10n * E, totalSupply: 10n * E };
    const shares = sharesForDeposit(5n * E, vault);
    expect(shares).toBeLessThanOrEqual(5n * E);
    expect(5n * E - shares).toBeLessThan(E / 50_000_000n);
  });

  it("mints fewer shares when a share is worth more", () => {
    const vault = { ...empty, totalNav: 20n * E, totalSupply: 10n * E };
    const shares = sharesForDeposit(2n * E, vault);
    expect(shares).toBeGreaterThan((E * 999n) / 1000n);
    expect(shares).toBeLessThanOrEqual(E);
  });

  it("takes the deposit fee off before minting", () => {
    expect(sharesForDeposit(100n * E, { ...empty, depositFeeBps: 100n })).toBe(99n * E);
  });

  it("is zero for nothing, and for supply with nothing behind it", () => {
    expect(sharesForDeposit(0n, empty)).toBe(0n);
    expect(sharesForDeposit(E, { ...empty, totalSupply: E })).toBe(0n);
  });
});

describe("valueForRedemption", () => {
  it("pays the pro rata share of the vault", () => {
    const vault = { ...empty, totalNav: 15n * E, totalSupply: 15n * E };
    expect(valueForRedemption(4n * E, vault)).toBe(4n * E);
  });

  it("takes the withdrawal fee off", () => {
    const vault = { ...empty, totalNav: 10n * E, totalSupply: 10n * E, withdrawFeeBps: 50n };
    expect(valueForRedemption(2n * E, vault)).toBe((2n * E * 9950n) / 10000n);
  });

  it("is zero while there are no shares", () => {
    expect(valueForRedemption(E, empty)).toBe(0n);
  });
});

describe("sharePrice", () => {
  it("is 1 while the vault is empty", () => {
    expect(sharePrice(empty)).toBe(E);
  });
  it("is NAV per share otherwise", () => {
    expect(sharePrice({ ...empty, totalNav: 11n * E, totalSupply: 10n * E })).toBe((11n * E) / 10n);
  });
});

describe("isSettleable", () => {
  it("settles straight away before the first valuation", () => {
    expect(isSettleable(1000n, 0n)).toBe(true);
  });
  it("needs a valuation made strictly after the request", () => {
    expect(isSettleable(1000n, 999n)).toBe(false);
    expect(isSettleable(1000n, 1000n)).toBe(false);
    expect(isSettleable(1000n, 1001n)).toBe(true);
  });
  it("is false when there is no request", () => {
    expect(isSettleable(0n, 0n)).toBe(false);
  });
});

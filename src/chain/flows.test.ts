import { describe, expect, it } from "vitest";
import { getAddress } from "viem";
import {
  depositProblem,
  depositStatus,
  planDeposit,
  redeemProblem,
  redeemStatus,
  remainingDepositSteps,
} from "./flows";
import type { UserState, VaultState } from "./state";

const E = 10n ** 18n;
const ME = getAddress("0x00000000000000000000000000000000000a11ce");
const ZERO = "0x0000000000000000000000000000000000000000" as const;

const vault = (over: Partial<VaultState> = {}): VaultState => ({
  totalNav: 10n * E,
  totalSupply: 10n * E,
  depositFeeBps: 0n,
  withdrawFeeBps: 0n,
  lastNavUpdateTime: 1_000n,
  redeemableWeth: 0n,
  isWhitelisted: false,
  ...over,
});

const user = (over: Partial<UserState> = {}): UserState => ({
  address: ME,
  eth: 5n * E,
  weth: 0n,
  allowance: 0n,
  shares: 0n,
  delegate: ZERO,
  depositRequest: { amount: 0n, time: 0n },
  redeemRequest: { amount: 0n, time: 0n },
  ...over,
});

const ids = (steps: { id: string }[]) => steps.map((step) => step.id);

describe("planDeposit", () => {
  it("wraps, requests, approves and delegates for a first deposit", () => {
    expect(ids(planDeposit(E, user(), vault()))).toEqual(["wrap", "request", "approve", "delegate"]);
  });

  it("completes in the same run only before the vault's first valuation", () => {
    const plan = planDeposit(E, user(), vault({ lastNavUpdateTime: 0n }));
    expect(ids(plan)).toEqual(["wrap", "request", "approve", "delegate", "complete"]);
  });

  it("wraps only what the wallet is short of", () => {
    const plan = planDeposit(3n * E, user({ weth: 2n * E }), vault());
    expect(plan[0].id).toBe("wrap");
    expect(plan[0].call.value).toBe(E);
  });

  it("skips what is already in place", () => {
    const ready = user({ weth: E, allowance: E, delegate: ME });
    expect(ids(planDeposit(E, ready, vault()))).toEqual(["request"]);
  });
});

describe("depositProblem", () => {
  it("accepts an amount the wallet can cover", () => {
    expect(depositProblem(E, user(), vault())).toBeUndefined();
  });
  it("refuses more than the wallet holds", () => {
    expect(depositProblem(6n * E, user(), vault())).toBe("Not enough ETH in this wallet.");
  });
  it("refuses wrapping the very last of the ETH", () => {
    expect(depositProblem(5n * E, user(), vault())).toBe("Leave a little ETH for network fees.");
  });
  it("counts WETH already held", () => {
    expect(depositProblem(6n * E, user({ weth: 2n * E }), vault())).toBeUndefined();
  });
  it("refuses a second request and a closed vault", () => {
    const open = user({ depositRequest: { amount: E, time: 5n } });
    expect(depositProblem(E, open, vault())).toMatch(/already have a deposit request/);
    expect(depositProblem(E, user(), vault({ isWhitelisted: true }))).toMatch(/approved wallets/);
  });
});

describe("an open deposit request", () => {
  const requested = (time: bigint, over: Partial<UserState> = {}) =>
    user({ weth: E, allowance: E, delegate: ME, depositRequest: { amount: E, time }, ...over });

  it("waits while the last valuation is older than the request", () => {
    const state = requested(2_000n);
    expect(depositStatus(state, vault())).toBe("waiting");
    expect(remainingDepositSteps(state, vault())).toEqual([]);
  });

  it("is ready once a valuation follows it", () => {
    const state = requested(500n);
    expect(depositStatus(state, vault())).toBe("ready");
    expect(ids(remainingDepositSteps(state, vault()))).toEqual(["complete"]);
  });

  it("asks for the approval before anything else", () => {
    const state = requested(500n, { allowance: 0n });
    expect(depositStatus(state, vault())).toBe("setup");
    expect(ids(remainingDepositSteps(state, vault()))).toEqual(["approve", "complete"]);
  });

  it("offers the delegation while waiting, without calling it unfinished", () => {
    const state = requested(2_000n, { delegate: ZERO });
    expect(depositStatus(state, vault())).toBe("waiting");
    expect(ids(remainingDepositSteps(state, vault()))).toEqual(["delegate"]);
  });

  it("says so when the WETH is gone and cannot be wrapped again", () => {
    const state = requested(500n, { weth: 0n, eth: E / 2n });
    expect(depositStatus(state, vault())).toBe("short");
    expect(ids(remainingDepositSteps(state, vault()))).not.toContain("wrap");
  });
});

describe("an open redemption request", () => {
  const redeeming = (time: bigint) =>
    user({ shares: 4n * E, redeemRequest: { amount: 4n * E, time } });

  it("waits for a valuation, then for funding, then is ready", () => {
    expect(redeemStatus(redeeming(2_000n), vault())).toBe("waiting");
    expect(redeemStatus(redeeming(500n), vault())).toBe("unfunded");
    expect(redeemStatus(redeeming(500n), vault({ redeemableWeth: 4n * E }))).toBe("ready");
  });

  it("checks a new request against the balance", () => {
    expect(redeemProblem(5n * E, user({ shares: 4n * E }))).toMatch(/more sciETH/);
    expect(redeemProblem(4n * E, user({ shares: 4n * E }))).toBeUndefined();
  });
});

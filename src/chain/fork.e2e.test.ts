/**
 * The page's own planning and reading code, driven against a local fork of
 * mainnet with real transactions: every step a depositor would sign, the
 * manager's valuations in between, and the page's predictions checked against
 * what the vault actually minted and paid.
 *
 * Opt-in, because it needs a fork:
 *   anvil --fork-url <mainnet rpc> --port 8546 --auto-impersonate --chain-id 1
 *   VITE_RPC_URL=http://127.0.0.1:8546 npx vitest run src/chain/fork.e2e.test.ts
 */
import { describe, expect, it } from "vitest";
import {
  encodeFunctionData,
  getAddress,
  numberToHex,
  parseAbi,
  parseEther,
  stringToHex,
  type Address,
  type Hex,
} from "viem";
import { ADDRESSES } from "../config";
import {
  calls,
  depositProblem,
  depositStatus,
  planDeposit,
  redeemStatus,
  remainingDepositSteps,
  type Call,
  type Step,
} from "./flows";
import { sharesForDeposit, valueForRedemption } from "./math";
import { publicClient, readUserState, readVaultState } from "./state";

const FORK = import.meta.env.VITE_RPC_URL;

const MANAGER: Address = "0xB5d01172e73559B07ef3CD53dE84459c6BA3a054";
const NAV_EXECUTOR: Address = "0x6Bcbc7959CE79b8F27efe1EAe504f98CBe2647A8";
const MANAGER_ROLE = stringToHex("defaulManagerRole", { size: 32 });
const ALICE = getAddress("0x00000000000000000000000000000000000a11ce");
const BOB = getAddress("0x0000000000000000000000000000000000000b0b");
const CAROL = getAddress("0x00000000000000000000000000000000000ca401");

const rolesAbi = parseAbi([
  "function execTransactionWithRole(address to, uint256 value, bytes data, uint8 operation, bytes32 roleKey, bool shouldRevert) returns (bool)",
]);
const navAbi = parseAbi(["function executeNAVUpdate(address navExecutor)"]);
const erc20Abi = parseAbi(["function transfer(address to, uint256 amount) returns (bool)"]);

const rpc = (method: string, params: unknown[]) =>
  publicClient.request({ method, params } as never) as Promise<any>;

const send = async (from: Address, call: Call, gas?: bigint) => {
  const hash: Hex = await rpc("eth_sendTransaction", [
    {
      from,
      to: call.to,
      data: call.data,
      ...(call.value > 0n ? { value: numberToHex(call.value) } : {}),
      ...(gas ? { gas: numberToHex(gas) } : {}),
    },
  ]);
  const receipt = await publicClient.waitForTransactionReceipt({ hash, pollingInterval: 100 });
  expect(receipt.status, `${from} -> ${call.to}`).toBe("success");
  return receipt;
};

const fund = (who: Address, eth: string) =>
  rpc("anvil_setBalance", [who, numberToHex(parseEther(eth))]);

/** The manager acting through the Roles modifier, exactly as the console does. */
const asManager = (to: Address, data: Hex) =>
  send(
    MANAGER,
    {
      to: ADDRESSES.rolesModifier,
      value: 0n,
      data: encodeFunctionData({
        abi: rolesAbi,
        functionName: "execTransactionWithRole",
        args: [to, 0n, data, 0, MANAGER_ROLE, true],
      }),
    },
    5_000_000n,
  );

const updateNav = async () => {
  // A valuation only unlocks requests made strictly before it.
  await rpc("evm_increaseTime", [60]);
  await asManager(
    ADDRESSES.vault,
    encodeFunctionData({ abi: navAbi, functionName: "executeNAVUpdate", args: [NAV_EXECUTOR] }),
  );
};

const runSteps = async (who: Address, steps: Step[]) => {
  for (const step of steps) await send(who, step.call);
};

const state = async (who: Address) => {
  const [vault, user] = await Promise.all([readVaultState(), readUserState(who)]);
  return { vault, user };
};

describe.skipIf(!FORK)("deposit and redeem on a mainnet fork", () => {
  it(
    "runs the whole life cycle with the page's own plans",
    async () => {
      await Promise.all([fund(ALICE, "100"), fund(BOB, "100"), fund(CAROL, "100"), fund(MANAGER, "10")]);

      /* 1. Before the vault's first valuation a deposit settles in one go. */
      let { vault, user } = await state(ALICE);
      expect(vault.lastNavUpdateTime).toBe(0n);
      expect(depositStatus(user, vault)).toBe("none");
      const ten = parseEther("10");
      expect(depositProblem(ten, user, vault)).toBeUndefined();

      let plan = planDeposit(ten, user, vault);
      expect(plan.map((step) => step.id)).toEqual(["wrap", "request", "approve", "delegate", "complete"]);
      const alicePredicted = sharesForDeposit(ten, vault);
      await runSteps(ALICE, plan);

      ({ vault, user } = await state(ALICE));
      expect(user.shares).toBe(alicePredicted);
      expect(user.shares).toBe(ten);
      expect(user.depositRequest.amount).toBe(0n);
      expect(user.delegate.toLowerCase()).toBe(ALICE.toLowerCase());
      expect(depositStatus(user, vault)).toBe("none");
      expect(vault.totalSupply).toBe(ten);

      /* 2. After a valuation, a new request has to wait for the next one. */
      await updateNav();
      await send(BOB, calls.wrap(parseEther("2"))); // Bob already holds some WETH
      ({ vault, user } = await state(BOB));
      expect(vault.lastNavUpdateTime).toBeGreaterThan(0n);

      const five = parseEther("5");
      plan = planDeposit(five, user, vault);
      expect(plan.map((step) => step.id)).toEqual(["wrap", "request", "approve", "delegate"]);
      expect(plan[0].call.value).toBe(parseEther("3")); // only the shortfall is wrapped

      // Mid-way: requested, not yet approved.
      await runSteps(BOB, plan.slice(0, 2));
      ({ vault, user } = await state(BOB));
      expect(user.depositRequest.amount).toBe(five);
      expect(depositStatus(user, vault)).toBe("setup");
      expect(remainingDepositSteps(user, vault).map((step) => step.id)).toEqual(["approve", "delegate"]);

      await runSteps(BOB, remainingDepositSteps(user, vault));
      ({ vault, user } = await state(BOB));
      expect(depositStatus(user, vault)).toBe("waiting");
      expect(remainingDepositSteps(user, vault)).toEqual([]);
      // The vault agrees that it cannot be completed yet.
      await expect(
        publicClient.call({ account: BOB, ...calls.completeDeposit() }),
      ).rejects.toThrow();

      /* 3. The next valuation makes it ready; the prediction matches the mint. */
      await updateNav();
      ({ vault, user } = await state(BOB));
      expect(depositStatus(user, vault)).toBe("ready");
      const bobSteps = remainingDepositSteps(user, vault);
      expect(bobSteps.map((step) => step.id)).toEqual(["complete"]);
      const bobPredicted = sharesForDeposit(five, vault);
      await runSteps(BOB, bobSteps);

      ({ vault, user } = await state(BOB));
      expect(user.shares).toBe(bobPredicted);
      // 1:1, give or take the contract's parts-per-billion share arithmetic.
      expect(five - user.shares).toBeLessThan(parseEther("0.00000002"));
      expect(user.shares).toBeLessThanOrEqual(five);
      expect(depositStatus(user, vault)).toBe("none");

      /* 4. Redemption: request, wait, wait for funding, withdraw. */
      const four = parseEther("4");
      await send(ALICE, calls.requestRedeem(four));
      ({ vault, user } = await state(ALICE));
      expect(user.redeemRequest.amount).toBe(four);
      expect(redeemStatus(user, vault)).toBe("waiting");

      await updateNav();
      ({ vault, user } = await state(ALICE));
      expect(redeemStatus(user, vault)).toBe("unfunded");
      await expect(publicClient.call({ account: ALICE, ...calls.withdraw() })).rejects.toThrow();

      // The manager moves WETH from the Safe into the vault to pay it.
      await asManager(
        ADDRESSES.weth,
        encodeFunctionData({
          abi: erc20Abi,
          functionName: "transfer",
          args: [ADDRESSES.vault, four + parseEther("0.000001")],
        }),
      );
      ({ vault, user } = await state(ALICE));
      expect(redeemStatus(user, vault)).toBe("ready");
      const payoutPredicted = valueForRedemption(four, vault);
      const wethBefore = user.weth;
      await send(ALICE, calls.withdraw());

      ({ vault, user } = await state(ALICE));
      const paid = user.weth - wethBefore;
      expect(paid).toBeLessThanOrEqual(payoutPredicted);
      expect(payoutPredicted - paid).toBeLessThanOrEqual(2n);
      expect(user.shares).toBe(ten - four);
      expect(redeemStatus(user, vault)).toBe("none");

      // And the WETH can go back to plain ETH.
      const ethBefore = user.eth;
      await send(ALICE, calls.unwrap(user.weth));
      ({ user } = await state(ALICE));
      expect(user.weth).toBe(0n);
      expect(user.eth).toBeGreaterThan(ethBefore);

      /* 5. Cancelling either kind of request clears it. */
      await send(BOB, calls.requestRedeem(parseEther("1")));
      await send(BOB, calls.cancel(false));
      ({ vault, user } = await state(BOB));
      expect(redeemStatus(user, vault)).toBe("none");
      expect(user.shares).toBe(bobPredicted);

      ({ vault, user } = await state(CAROL));
      const one = parseEther("1");
      await runSteps(CAROL, planDeposit(one, user, vault));
      ({ vault, user } = await state(CAROL));
      expect(depositStatus(user, vault)).toBe("waiting");
      expect(depositProblem(one, user, vault)).toBe("You already have a deposit request open.");
      await send(CAROL, calls.cancel(true));
      ({ vault, user } = await state(CAROL));
      expect(depositStatus(user, vault)).toBe("none");
      // The WETH, allowance and delegation from the cancelled request are reused.
      expect(planDeposit(one, user, vault).map((step) => step.id)).toEqual(["request"]);

      /* 6. A request whose WETH was spent says so, and is fixed by wrapping again. */
      await runSteps(CAROL, planDeposit(one, user, vault));
      await send(CAROL, calls.unwrap(one));
      ({ vault, user } = await state(CAROL));
      expect(depositStatus(user, vault)).toBe("setup");
      expect(remainingDepositSteps(user, vault).map((step) => step.id)).toEqual(["wrap"]);
      await runSteps(CAROL, remainingDepositSteps(user, vault));
      ({ vault, user } = await state(CAROL));
      expect(depositStatus(user, vault)).toBe("waiting");
    },
    180_000,
  );
});

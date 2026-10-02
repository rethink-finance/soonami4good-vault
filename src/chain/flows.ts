import { encodeFunctionData, type Address, type Hex } from "viem";
import { ADDRESSES } from "../config";
import { flowsAbi, vaultAbi, wethAbi } from "./abi";
import { isSettleable, valueForRedemption } from "./math";
import type { UserState, VaultState } from "./state";

/**
 * What a depositor signs, in order. Which of these a given deposit needs is
 * decided from chain state alone (planDeposit / nextDepositSteps), so a page
 * reloaded halfway through picks up exactly where the wallet left off.
 */
export type StepId =
  | "wrap"
  | "request"
  | "approve"
  | "delegate"
  | "complete"
  | "requestRedeem"
  | "withdraw"
  | "cancelDeposit"
  | "cancelRedeem"
  | "unwrap";

export interface Call {
  to: Address;
  data: Hex;
  value: bigint;
}

export interface Step {
  id: StepId;
  /** What the step does, as shown in the progress list. */
  label: string;
  call: Call;
}

const flowCall = (data: Hex): Call => ({
  to: ADDRESSES.vault,
  value: 0n,
  data: encodeFunctionData({ abi: vaultAbi, functionName: "fundFlowsCall", args: [data] }),
});

export const calls = {
  wrap: (amount: bigint): Call => ({
    to: ADDRESSES.weth,
    value: amount,
    data: encodeFunctionData({ abi: wethAbi, functionName: "deposit" }),
  }),
  unwrap: (amount: bigint): Call => ({
    to: ADDRESSES.weth,
    value: 0n,
    data: encodeFunctionData({ abi: wethAbi, functionName: "withdraw", args: [amount] }),
  }),
  approve: (amount: bigint): Call => ({
    to: ADDRESSES.weth,
    value: 0n,
    data: encodeFunctionData({
      abi: wethAbi,
      functionName: "approve",
      args: [ADDRESSES.vault, amount],
    }),
  }),
  delegate: (to: Address): Call => ({
    to: ADDRESSES.vault,
    value: 0n,
    data: encodeFunctionData({ abi: vaultAbi, functionName: "delegate", args: [to] }),
  }),
  requestDeposit: (amount: bigint): Call =>
    flowCall(encodeFunctionData({ abi: flowsAbi, functionName: "requestDeposit", args: [amount] })),
  completeDeposit: (): Call =>
    flowCall(encodeFunctionData({ abi: flowsAbi, functionName: "deposit" })),
  requestRedeem: (shares: bigint): Call =>
    flowCall(
      encodeFunctionData({ abi: flowsAbi, functionName: "requestWithdraw", args: [shares] }),
    ),
  withdraw: (): Call => flowCall(encodeFunctionData({ abi: flowsAbi, functionName: "withdraw" })),
  cancel: (isDeposit: boolean): Call =>
    flowCall(
      encodeFunctionData({
        abi: flowsAbi,
        functionName: "revokeDepositWithrawal",
        args: [isDeposit],
      }),
    ),
};

const votesForSelf = (user: UserState) =>
  user.delegate.toLowerCase() === user.address.toLowerCase();

/** ETH that has to be wrapped so the wallet holds `amount` WETH. */
export const wrapNeeded = (amount: bigint, user: UserState): bigint =>
  amount > user.weth ? amount - user.weth : 0n;

/**
 * Why a new deposit of `amount` cannot be started, or undefined when it can.
 * These are the contract's own requirements, checked here because the vault
 * hides the reason for a failed flow call behind a generic revert.
 */
export const depositProblem = (
  amount: bigint,
  user: UserState,
  vault: VaultState,
): string | undefined => {
  if (amount <= 0n) return "Enter an amount.";
  if (user.depositRequest.amount > 0n) return "You already have a deposit request open.";
  if (vault.isWhitelisted) return "This vault currently accepts deposits from approved wallets only.";
  const toWrap = wrapNeeded(amount, user);
  if (toWrap > user.eth) return "Not enough ETH in this wallet.";
  if (toWrap > 0n && toWrap === user.eth) return "Leave a little ETH for network fees.";
  return undefined;
};

/**
 * Everything a fresh deposit of `amount` needs, skipping what is already in
 * place (WETH already held, an allowance left from a cancelled request, a
 * standing self-delegation).
 *
 * The request has to be followed by a valuation before it can complete, so
 * "complete" is only part of the plan while the vault has never been valued:
 * in that one case the contract lets a request settle straight away.
 */
export const planDeposit = (amount: bigint, user: UserState, vault: VaultState): Step[] => {
  const steps: Step[] = [];
  const toWrap = wrapNeeded(amount, user);
  if (toWrap > 0n) {
    steps.push({ id: "wrap", label: "Wrap ETH", call: calls.wrap(toWrap) });
  }
  steps.push({ id: "request", label: "Request deposit", call: calls.requestDeposit(amount) });
  if (user.allowance < amount) {
    steps.push({ id: "approve", label: "Approve WETH", call: calls.approve(amount) });
  }
  if (!votesForSelf(user)) {
    steps.push({ id: "delegate", label: "Enable voting", call: calls.delegate(user.address) });
  }
  if (vault.lastNavUpdateTime === 0n) {
    steps.push({ id: "complete", label: "Complete deposit", call: calls.completeDeposit() });
  }
  return steps;
};

/**
 * What is left to do for a deposit request that already exists on chain.
 * Empty when the only thing left is to wait for the next valuation.
 */
export const remainingDepositSteps = (user: UserState, vault: VaultState): Step[] => {
  const request = user.depositRequest;
  if (request.amount === 0n) return [];
  const steps: Step[] = [];
  const toWrap = wrapNeeded(request.amount, user);
  if (toWrap > 0n && toWrap < user.eth) {
    steps.push({ id: "wrap", label: "Wrap ETH", call: calls.wrap(toWrap) });
  }
  if (user.allowance < request.amount) {
    steps.push({ id: "approve", label: "Approve WETH", call: calls.approve(request.amount) });
  }
  if (!votesForSelf(user)) {
    steps.push({ id: "delegate", label: "Enable voting", call: calls.delegate(user.address) });
  }
  if (isSettleable(request.time, vault.lastNavUpdateTime)) {
    steps.push({ id: "complete", label: "Complete deposit", call: calls.completeDeposit() });
  }
  return steps;
};

export type DepositStatus =
  /** No request open. */
  | "none"
  /** Request open, wallet still has steps to sign before it can settle. */
  | "setup"
  /** Everything signed; waiting for the vault's next valuation. */
  | "waiting"
  /** Can be completed now. */
  | "ready"
  /** The wallet no longer holds the WETH the request is for. */
  | "short";

export const depositStatus = (user: UserState, vault: VaultState): DepositStatus => {
  const request = user.depositRequest;
  if (request.amount === 0n) return "none";
  const settleable = isSettleable(request.time, vault.lastNavUpdateTime);
  const toWrap = wrapNeeded(request.amount, user);
  if (toWrap >= user.eth && toWrap > 0n) return "short";
  if (toWrap > 0n || user.allowance < request.amount) return "setup";
  return settleable ? "ready" : "waiting";
};

export type RedeemStatus =
  | "none"
  | "waiting"
  /** Settleable, but the vault has not yet set aside the WETH to pay it. */
  | "unfunded"
  | "ready";

export const redeemStatus = (user: UserState, vault: VaultState): RedeemStatus => {
  const request = user.redeemRequest;
  if (request.amount === 0n) return "none";
  if (!isSettleable(request.time, vault.lastNavUpdateTime)) return "waiting";
  // The vault pays redemptions from WETH the manager has moved into the vault
  // contract. Until that covers this request, withdraw() reverts.
  return vault.redeemableWeth >= valueForRedemption(request.amount, vault) ? "ready" : "unfunded";
};

export const redeemProblem = (shares: bigint, user: UserState): string | undefined => {
  if (shares <= 0n) return "Enter an amount.";
  if (user.redeemRequest.amount > 0n) return "You already have a redemption request open.";
  if (shares > user.shares) return "That is more sciETH than this wallet holds.";
  return undefined;
};

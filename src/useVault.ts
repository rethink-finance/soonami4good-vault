import { reactive, watch } from "vue";
import { numberToHex } from "viem";
import { CHAIN_ID_HEX, REFRESH_INTERVAL_MS } from "./config";
import {
  calls,
  planDeposit,
  remainingDepositSteps,
  type Step,
  type StepId,
} from "./chain/flows";
import { isSettleable } from "./chain/math";
import {
  publicClient,
  readUserState,
  readVaultState,
  VaultMismatchError,
  type UserState,
  type VaultState,
} from "./chain/state";
import {
  getAtomicBatchStatus,
  isBatchUnsupportedError,
  isUpgradeRejectionError,
  isUserRejectionError,
  isWalletCallsSuccess,
  isWalletRpcHealthError,
  sendWalletCalls,
  waitForWalletCalls,
  WALLET_RPC_HEALTH_MESSAGE,
  WalletCallsTimeoutError,
} from "./wallet/eip5792";
import { ensureMainnet, sendTransaction, wallet, WrongNetworkError } from "./wallet/wallet";

export type StepStatus = "todo" | "signing" | "pending" | "done";

export interface RunStep {
  id: StepId;
  label: string;
  status: StepStatus;
}

/** One click's worth of wallet work, as the card shows it. */
export interface Run {
  steps: RunStep[];
  /** All steps go to the wallet as a single confirmation. */
  batched: boolean;
  active: boolean;
  /** Something went wrong; the run has stopped. */
  error?: string;
  /** A neutral ending that still needs saying (declined, still confirming). */
  notice?: string;
  /** What just happened, once the run has finished cleanly. */
  success?: string;
}

interface Store {
  vault?: VaultState;
  user?: UserState;
  /** The chain could not be read at all. */
  loadError?: string;
  /** The vault's settings no longer match this page: sending is disabled. */
  mismatch: boolean;
  run?: Run;
}

export const store = reactive<Store>({ mismatch: false });

let refreshing: Promise<void> | undefined;

/** Re-read the vault and, when a wallet is connected, the wallet's side. */
export const refresh = (): Promise<void> => {
  refreshing ??= (async () => {
    try {
      const account = wallet.account;
      const [vault, user] = await Promise.all([
        readVaultState(),
        account ? readUserState(account) : Promise.resolve(undefined),
      ]);
      store.vault = vault;
      // The account can change while the read is in flight.
      if (user?.address === wallet.account) store.user = user;
      else if (!wallet.account) store.user = undefined;
      store.loadError = undefined;
      store.mismatch = false;
    } catch (error) {
      if (error instanceof VaultMismatchError) {
        store.mismatch = true;
        store.loadError = error.message;
      } else if (!store.vault) {
        // Only worth a message when there is nothing to show; a failed
        // background refresh keeps the last good figures on screen.
        store.loadError = "Could not reach Ethereum. Check your connection and reload.";
      }
      console.error("refresh failed", error);
    } finally {
      refreshing = undefined;
    }
  })();
  return refreshing;
};

export const startRefreshing = () => {
  void refresh();
  setInterval(() => {
    if (!document.hidden && !store.run?.active) void refresh();
  }, REFRESH_INTERVAL_MS);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden && !store.run?.active) void refresh();
  });
  watch(
    () => wallet.account,
    () => {
      store.user = undefined;
      store.run = undefined;
      void refresh();
    },
  );
};

/**
 * Wallets that refused the account upgrade a batch needs chose to stay plain
 * accounts. The offer is not repeated this session; their steps go one by one.
 */
let upgradeDeclined = false;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Dry-run a step from the depositor's account before the wallet is asked to
 * sign it, so nobody pays gas for a transaction the vault will refuse. The
 * step before it was mined a moment ago and a load-balanced endpoint can
 * briefly answer from a node that has not seen it, hence the second try.
 */
const wouldSucceed = async (step: Step): Promise<boolean> => {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await publicClient.call({
        account: wallet.account,
        to: step.call.to,
        data: step.call.data,
        value: step.call.value,
      });
      return true;
    } catch {
      if (attempt === 0) await sleep(2_000);
    }
  }
  return false;
};

const REFUSED: Partial<Record<StepId, string>> = {
  complete: "This deposit cannot be completed yet. Try again after the vault's next valuation.",
  withdraw: "The vault cannot pay this redemption yet. Try again a little later.",
  request: "The vault would refuse this request. Check your balance and try again.",
  requestRedeem: "The vault would refuse this request. Check your sciETH balance and try again.",
};

const describeFailure = (error: unknown): { error?: string; notice?: string } => {
  if (isUserRejectionError(error)) return { notice: "Cancelled in your wallet. Nothing was sent." };
  if (error instanceof WrongNetworkError) return { error: error.message };
  if (isWalletRpcHealthError(error)) return { error: WALLET_RPC_HEALTH_MESSAGE };
  if (error instanceof WalletCallsTimeoutError) {
    return {
      notice:
        "This is taking longer than expected. It may still confirm; the page will update when it does.",
    };
  }
  console.error("step failed", error);
  return { error: "Something went wrong and the step did not go through. Please try again." };
};

type BatchOutcome = "done" | "unsupported";

const runBatch = async (run: Run, steps: Step[]): Promise<BatchOutcome> => {
  const provider = wallet.active!.provider;
  const account = wallet.account!;
  if (upgradeDeclined) return "unsupported";
  const status = await getAtomicBatchStatus(provider, account, CHAIN_ID_HEX);
  if (status === "unsupported") return "unsupported";

  run.batched = true;
  run.steps.forEach((step) => (step.status = "signing"));
  let batchId: string;
  try {
    batchId = await sendWalletCalls(provider, {
      chainId: CHAIN_ID_HEX,
      from: account,
      calls: steps.map(({ call }) => ({
        to: call.to,
        data: call.data,
        ...(call.value > 0n ? { value: numberToHex(call.value) } : {}),
      })),
    });
  } catch (error) {
    const declinedUpgrade = isUpgradeRejectionError(error);
    if (declinedUpgrade) upgradeDeclined = true;
    if (declinedUpgrade || isBatchUnsupportedError(error)) {
      run.batched = false;
      run.steps.forEach((step) => (step.status = "todo"));
      return "unsupported";
    }
    throw error;
  }

  run.steps.forEach((step) => (step.status = "pending"));
  const result = await waitForWalletCalls(provider, batchId);
  if (!isWalletCallsSuccess(result)) {
    throw new Error(`Call bundle ended with status ${result.statusCode}.`);
  }
  run.steps.forEach((step) => (step.status = "done"));
  return "done";
};

const REQUESTED_MESSAGE =
  "Deposit requested. Come back after the vault's next valuation to complete it.";

/** Resolves false when the run had to stop before its last step (see below). */
const runOneByOne = async (run: Run, steps: Step[]): Promise<boolean> => {
  for (const [index, step] of steps.entries()) {
    const shown = run.steps[index];
    if (shown.status === "done") continue;

    // "Complete" is only in a fresh deposit's plan while the vault has never
    // been valued. If a valuation landed while the earlier steps were being
    // signed, the request now has to wait for the next one: stop here, and
    // the pending-request panel takes over.
    if (step.id === "complete") {
      await refresh();
      const request = store.user?.depositRequest;
      if (!request || !store.vault) return false;
      if (!isSettleable(request.time, store.vault.lastNavUpdateTime)) {
        run.steps.splice(index);
        return false;
      }
    }

    shown.status = "signing";
    if (!(await wouldSucceed(step))) {
      shown.status = "todo";
      throw new RefusedError(step.id);
    }
    const hash = await sendTransaction(step.call);
    shown.status = "pending";
    const receipt = await publicClient.waitForTransactionReceipt({
      hash,
      timeout: 600_000,
    });
    if (receipt.status !== "success") {
      shown.status = "todo";
      throw new Error(`Transaction ${hash} reverted.`);
    }
    shown.status = "done";
    await refresh();
  }
  return true;
};

class RefusedError extends Error {
  constructor(public stepId: StepId) {
    super(`Step ${stepId} would be refused.`);
  }
}

/**
 * Run `steps` through the wallet: as one confirmation when the wallet can
 * batch, otherwise one transaction at a time. State on screen comes from the
 * chain, so a run that stops halfway leaves the page showing what is left.
 */
const execute = async (steps: Step[], success: string) => {
  if (store.run?.active || steps.length === 0) return;
  if (!wallet.active || !wallet.account) return;
  if (store.mismatch) return;

  const run: Run = reactive({
    steps: steps.map(({ id, label }) => ({ id, label, status: "todo" as StepStatus })),
    batched: false,
    active: true,
  });
  store.run = run;

  try {
    await ensureMainnet();
    const outcome = steps.length > 1 ? await runBatch(run, steps) : "unsupported";
    const finished = outcome === "done" || (await runOneByOne(run, steps));
    run.success = finished ? success : REQUESTED_MESSAGE;
  } catch (error) {
    if (error instanceof RefusedError) {
      run.error = REFUSED[error.stepId] ?? "This step would fail right now. Please try again later.";
    } else {
      Object.assign(run, describeFailure(error));
    }
    run.steps.forEach((step) => {
      if (step.status === "signing") step.status = "todo";
    });
  } finally {
    // Refresh before the run is marked finished: the card clears a finished
    // run's message when the request it was about changes state later, and
    // the change this run itself caused must not count as "later".
    await refresh();
    run.active = false;
    // Public endpoints can lag a block behind the wallet's own node.
    setTimeout(() => void refresh(), 4_000);
  }
};

export const dismissRun = () => {
  if (!store.run?.active) store.run = undefined;
};

export const actions = {
  deposit: (amount: bigint) => {
    if (!store.user || !store.vault) return;
    const steps = planDeposit(amount, store.user, store.vault);
    const settlesNow = steps.some((step) => step.id === "complete");
    return execute(
      steps,
      settlesNow ? "Deposit complete. Your sciETH is in your wallet." : REQUESTED_MESSAGE,
    );
  },
  continueDeposit: () => {
    if (!store.user || !store.vault) return;
    const steps = remainingDepositSteps(store.user, store.vault);
    const completes = steps.some((step) => step.id === "complete");
    return execute(
      steps,
      completes ? "Deposit complete. Your sciETH is in your wallet." : "Your deposit request is all set.",
    );
  },
  cancelDeposit: () =>
    execute(
      [{ id: "cancelDeposit", label: "Cancel deposit request", call: calls.cancel(true) }],
      "Deposit request cancelled.",
    ),
  requestRedeem: (shares: bigint) =>
    execute(
      [{ id: "requestRedeem", label: "Request redemption", call: calls.requestRedeem(shares) }],
      "Redemption requested. Come back after the vault's next valuation to withdraw.",
    ),
  withdraw: () =>
    execute(
      [{ id: "withdraw", label: "Withdraw", call: calls.withdraw() }],
      "Withdrawn. The WETH is in your wallet.",
    ),
  cancelRedeem: () =>
    execute(
      [{ id: "cancelRedeem", label: "Cancel redemption request", call: calls.cancel(false) }],
      "Redemption request cancelled.",
    ),
  unwrap: (amount: bigint) =>
    execute(
      [{ id: "unwrap", label: "Unwrap WETH", call: calls.unwrap(amount) }],
      "Unwrapped. The ETH is in your wallet.",
    ),
};

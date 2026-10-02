/**
 * EIP-5792 call batching, spoken straight to the wallet's EIP-1193 provider.
 * Ported from the Rethink app (services/eip5792.ts), where it is verified
 * against MetaMask smart accounts.
 *
 * A deposit is several transactions that all read msg.sender (wrap, request,
 * approve, delegate), so no router contract can merge them. A wallet that
 * supports wallet_sendCalls merges them anyway, because it executes the batch
 * from the depositor's own account: one confirmation, msg.sender intact.
 *
 * Nothing here assumes the wallet cooperates. Every error maps to one of
 * three reactions: the user said no, the wallet cannot batch (send the
 * transactions one by one instead), or something actually failed.
 */

export interface Eip1193Provider {
  request(args: { method: string; params?: unknown[] | object }): Promise<any>;
  on?(event: string, listener: (...args: any[]) => void): void;
  removeListener?(event: string, listener: (...args: any[]) => void): void;
}

export interface WalletBatchCall {
  to: string;
  data?: string;
  value?: string;
}

/**
 * "supported": the account already executes batches atomically.
 * "ready": it can, after an upgrade the wallet offers inside the confirmation
 * (EIP-7702); the user may still refuse it there.
 */
export type AtomicBatchStatus = "supported" | "ready" | "unsupported";

const parseChainKey = (chainId: string): bigint | undefined => {
  try {
    return BigInt(chainId);
  } catch {
    return undefined;
  }
};

export const parseAtomicBatchStatus = (
  capabilities: unknown,
  chainId: string,
): AtomicBatchStatus => {
  const wanted = parseChainKey(chainId);
  if (wanted === undefined || !capabilities || typeof capabilities !== "object") {
    return "unsupported";
  }
  for (const [key, chainCapabilities] of Object.entries(capabilities)) {
    if (parseChainKey(key) !== wanted) continue;
    const status = (chainCapabilities as any)?.atomic?.status;
    if (status === "supported" || status === "ready") return status;
  }
  return "unsupported";
};

export const getAtomicBatchStatus = async (
  provider: Eip1193Provider,
  account: string,
  chainId: string,
): Promise<AtomicBatchStatus> => {
  try {
    // Asks for every chain: early implementations disagree about the optional
    // chain filter, and the answer is filtered locally either way.
    const capabilities = await provider.request({
      method: "wallet_getCapabilities",
      params: [account],
    });
    return parseAtomicBatchStatus(capabilities, chainId);
  } catch (error) {
    // A wallet whose RPC endpoint is failing rejects this probe like any other
    // request. That is a verdict on the endpoint, not on batching.
    if (isWalletRpcHealthError(error)) throw error;
    return "unsupported";
  }
};

/**
 * Submit a batch and return its bundle id. atomicRequired because a request
 * landing without the wrap or approval that funds it is worse than nothing
 * landing at all.
 */
export const sendWalletCalls = async (
  provider: Eip1193Provider,
  { chainId, from, calls }: { chainId: string; from: string; calls: WalletBatchCall[] },
): Promise<string> => {
  const result = await provider.request({
    method: "wallet_sendCalls",
    params: [{ version: "2.0.0", chainId, from, atomicRequired: true, calls }],
  });
  const batchId = typeof result === "string" ? result : result?.id;
  if (typeof batchId !== "string" || !batchId) {
    throw new Error("The wallet returned no call bundle id.");
  }
  return batchId;
};

/**
 * Final-spec codes: 100 pending, 200 confirmed, 400 failed off chain, 500
 * reverted, 600 partially reverted. Older wallets report strings; anything
 * unrecognizable counts as pending and is left to the poll timeout.
 */
export const normalizeCallsStatus = (status: unknown): number => {
  if (typeof status === "number") return status;
  if (typeof status === "string") {
    const legacy: Record<string, number> = { PENDING: 100, CONFIRMED: 200, FAILED: 500 };
    return legacy[status.toUpperCase()] ?? 100;
  }
  return 100;
};

export interface WalletCallsResult {
  statusCode: number;
  receipts: any[];
}

export class WalletCallsTimeoutError extends Error {
  constructor(batchId: string) {
    super(`Timed out waiting for call bundle ${batchId} to confirm.`);
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Poll until the bundle reaches a terminal state. A just-submitted id can be
 * momentarily unknown to the wallet, so single status errors are tolerated;
 * three in a row count as a real failure.
 */
export const waitForWalletCalls = async (
  provider: Eip1193Provider,
  batchId: string,
  { timeoutMs = 300_000, pollIntervalMs = 2_500 } = {},
): Promise<WalletCallsResult> => {
  const startedAt = Date.now();
  let consecutiveErrors = 0;
  for (;;) {
    try {
      const raw = await provider.request({ method: "wallet_getCallsStatus", params: [batchId] });
      consecutiveErrors = 0;
      const statusCode = normalizeCallsStatus(raw?.status);
      if (statusCode >= 200) return { statusCode, receipts: raw?.receipts ?? [] };
    } catch (error) {
      consecutiveErrors += 1;
      if (consecutiveErrors >= 3) throw error;
    }
    if (Date.now() - startedAt >= timeoutMs) throw new WalletCallsTimeoutError(batchId);
    await sleep(pollIntervalMs);
  }
};

/** 200 already means "included without reverts"; receipts are checked anyway. */
export const isWalletCallsSuccess = (result: WalletCallsResult): boolean => {
  if (result.statusCode !== 200) return false;
  return result.receipts.every((receipt: any) => {
    const status = receipt?.status;
    return (
      status === undefined || status === "0x1" || status === 1 || status === 1n || status === true
    );
  });
};

const errorCodeOf = (error: any): number | undefined => {
  const code = error?.code ?? error?.error?.code ?? error?.data?.code;
  return typeof code === "number" ? code : undefined;
};

const errorMessageOf = (error: any): string =>
  [error?.message, error?.error?.message, error?.data?.message]
    .filter((part) => typeof part === "string")
    .join(" | ");

/**
 * The wallet's own RPC endpoint is down, rate-limited or out of quota (seen
 * as MetaMask's circuit breaker). The remedy belongs to the user, so callers
 * say that instead of a generic failure. Matched on the message: the codes
 * seen so far are catch-alls.
 */
export const isWalletRpcHealthError = (error: any): boolean =>
  /too many errors|circuit break|consider using a different rpc|reached the usage limit|rate.?limit/i.test(
    errorMessageOf(error),
  );

export const WALLET_RPC_HEALTH_MESSAGE =
  "Your wallet's connection to Ethereum is failing. Wait a minute and try again, or switch the network's RPC endpoint in your wallet settings.";

/** The user said no to the confirmation itself. */
export const isUserRejectionError = (error: any): boolean => {
  const code = errorCodeOf(error);
  if (code === 4001) return true;
  return /user (rejected|denied)|rejected by user/i.test(errorMessageOf(error));
};

/**
 * 5750: the wallet could batch after an account upgrade and the user refused
 * the upgrade, not the deposit. The right reaction is one-by-one sends.
 */
export const isUpgradeRejectionError = (error: any): boolean => errorCodeOf(error) === 5750;

/** The wallet cannot run this batch at all: send the transactions one by one. */
export const isBatchUnsupportedError = (error: any): boolean => {
  const code = errorCodeOf(error);
  if (code === undefined) {
    return /method.+(not (found|supported|available)|does not exist)/i.test(errorMessageOf(error));
  }
  return [-32601, -32004, 5700, 5710, 5740].includes(code);
};

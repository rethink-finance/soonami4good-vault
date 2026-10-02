import {
  createPublicClient,
  encodeAbiParameters,
  fallback,
  http,
  keccak256,
  type Address,
  type Hex,
  type PublicClient,
} from "viem";
import { mainnet } from "viem/chains";
import { ADDRESSES, RPC_URLS } from "../config";
import { multicall3Abi, vaultAbi, wethAbi } from "./abi";
import type { VaultFigures } from "./math";

/** A fork to read from while developing; never set in a production build. */
const devRpcUrl = import.meta.env.DEV ? import.meta.env.VITE_RPC_URL : undefined;

export const publicClient: PublicClient = createPublicClient({
  chain: mainnet,
  transport: devRpcUrl
    ? http(devRpcUrl)
    : fallback(RPC_URLS.map((url) => http(url, { timeout: 12_000 }))),
});

export interface VaultState extends VaultFigures {
  /** Seconds. Zero until the vault has had its first valuation. */
  lastNavUpdateTime: bigint;
  /** WETH the vault contract holds for paying redemptions, fees excluded. */
  redeemableWeth: bigint;
  isWhitelisted: boolean;
}

export interface FlowRequest {
  /** WETH wei for a deposit, sciETH wei for a redemption. Zero when none. */
  amount: bigint;
  /** Seconds. */
  time: bigint;
}

export interface UserState {
  address: Address;
  eth: bigint;
  weth: bigint;
  /** WETH the vault may pull from the wallet. */
  allowance: bigint;
  shares: bigint;
  /** Who votes with this wallet's sciETH. Zero address when nobody does. */
  delegate: Address;
  depositRequest: FlowRequest;
  redeemRequest: FlowRequest;
}

const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

export class VaultMismatchError extends Error {
  constructor(what: string) {
    super(`The vault no longer matches this page (${what}).`);
  }
}

export const readVaultState = async (): Promise<VaultState> => {
  const vault = { address: ADDRESSES.vault, abi: vaultAbi } as const;
  const [totalNav, totalSupply, lastNavUpdateTime, feeBalance, settings, vaultWeth] =
    await publicClient.multicall({
      allowFailure: false,
      contracts: [
        { ...vault, functionName: "totalNAV" },
        { ...vault, functionName: "totalSupply" },
        { ...vault, functionName: "_navUpdateLatestTime" },
        { ...vault, functionName: "_feeBal" },
        { ...vault, functionName: "getFundSettings" },
        { address: ADDRESSES.weth, abi: wethAbi, functionName: "balanceOf", args: [ADDRESSES.vault] },
      ],
    });

  // Governance can change the vault's settings. Everything this page does
  // assumes WETH in, sciETH as its own voting token, and this Safe; if a vote
  // changes any of that, stop rather than send people somewhere unexpected.
  if (!same(settings.baseToken, ADDRESSES.weth)) throw new VaultMismatchError("base token");
  if (!same(settings.safe, ADDRESSES.safe)) throw new VaultMismatchError("custody");
  if (!same(settings.governanceToken, ADDRESSES.vault)) {
    throw new VaultMismatchError("voting token");
  }

  return {
    totalNav,
    totalSupply,
    lastNavUpdateTime,
    depositFeeBps: settings.depositFee,
    withdrawFeeBps: settings.withdrawFee,
    redeemableWeth: vaultWeth > feeBalance ? vaultWeth - feeBalance : 0n,
    isWhitelisted: settings.isWhitelistedDeposits,
  };
};

/**
 * Open requests have no getter. They sit in two mappings in the vault's
 * storage (GovernableFundStorage.sol: userDepositRequest at slot 273,
 * userWithdrawRequest at 274), each entry an (amount, requestTime) pair in
 * consecutive slots.
 */
const DEPOSIT_REQUEST_SLOT = 273n;
const REDEEM_REQUEST_SLOT = 274n;

export const requestStorageKeys = (user: Address, mappingSlot: bigint): [Hex, Hex] => {
  const base = keccak256(
    encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [user, mappingSlot]),
  );
  const next = `0x${(BigInt(base) + 1n).toString(16).padStart(64, "0")}` as Hex;
  return [base, next];
};

const readRequest = async (user: Address, mappingSlot: bigint): Promise<FlowRequest> => {
  const [amountKey, timeKey] = requestStorageKeys(user, mappingSlot);
  const [amount, time] = await Promise.all([
    publicClient.getStorageAt({ address: ADDRESSES.vault, slot: amountKey }),
    publicClient.getStorageAt({ address: ADDRESSES.vault, slot: timeKey }),
  ]);
  return { amount: BigInt(amount ?? "0x0"), time: BigInt(time ?? "0x0") };
};

export const readUserState = async (address: Address): Promise<UserState> => {
  const multicall3 = mainnet.contracts.multicall3.address;
  const [balances, depositRequest, redeemRequest] = await Promise.all([
    publicClient.multicall({
      allowFailure: false,
      contracts: [
        { address: multicall3, abi: multicall3Abi, functionName: "getEthBalance", args: [address] },
        { address: ADDRESSES.weth, abi: wethAbi, functionName: "balanceOf", args: [address] },
        {
          address: ADDRESSES.weth,
          abi: wethAbi,
          functionName: "allowance",
          args: [address, ADDRESSES.vault],
        },
        { address: ADDRESSES.vault, abi: vaultAbi, functionName: "balanceOf", args: [address] },
        { address: ADDRESSES.vault, abi: vaultAbi, functionName: "delegates", args: [address] },
      ],
    }),
    readRequest(address, DEPOSIT_REQUEST_SLOT),
    readRequest(address, REDEEM_REQUEST_SLOT),
  ]);
  const [eth, weth, allowance, shares, delegate] = balances;
  return { address, eth, weth, allowance, shares, delegate, depositRequest, redeemRequest };
};

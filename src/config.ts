import type { Address } from "viem";

/** Ethereum mainnet. The vault lives nowhere else. */
export const CHAIN_ID = 1;
export const CHAIN_ID_HEX = "0x1";

/**
 * Every address the page touches. The vault, Safe and governor were read back
 * from the vault's own getFundSettings() on 2026-10-02; the page re-reads the
 * settings on every refresh and refuses to send if they stop matching (see
 * readVaultState).
 */
export const ADDRESSES = {
  /** GovernableFund: the sciETH token and the contract deposits go through. */
  vault: "0x2741408077cd7C7D3943D0142bafAE28c97EAA35",
  /** Safe that holds the vault's assets. */
  safe: "0xfBF17BFf29D7798626E1188272aFDA107152F070",
  rolesModifier: "0x02b3BD4BD280ECF97E9ff60f9390b47B750cc8c6",
  governor: "0x7B679e1566fBCbAd86e3063E696d54764255F6d5",
  /** Where staking yield is sent. */
  yieldMultisig: "0xf0b31Db69b57023b2050eCa2A32932Dd0CEac9E9",
  /** The vault's base token. */
  weth: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2",
} as const satisfies Record<string, Address>;

/**
 * Public endpoints that answer browser calls (CORS open), in the order the
 * Rethink app uses them. Reads fall through the list on failure.
 */
export const RPC_URLS = [
  "https://eth.drpc.org",
  "https://mainnet.gateway.tenderly.co",
  "https://rpc.mevblocker.io",
  "https://rpc.flashbots.net",
];

export const EXPLORER_URL = "https://etherscan.io";
export const RETHINK_VAULT_URL =
  "https://app.rethink.finance/details/0x1-sciETH-0x2741408077cd7C7D3943D0142bafAE28c97EAA35";
export const SCIENTIFIC_VOTE_URL = "https://scientificvote.soonami4good.eth.limo/";
export const SOONAMI_URL = "https://soonami4good.org/";

/**
 * ETH left in the wallet when "Max" is pressed, so the remaining steps of a
 * deposit can still pay for gas. The whole flow is about 500k gas.
 */
export const GAS_RESERVE_WEI = 5_000_000_000_000_000n; // 0.005 ETH

/** How often open pages re-read the chain. */
export const REFRESH_INTERVAL_MS = 30_000;

import { reactive } from "vue";
import { getAddress, numberToHex, type Address, type Hex } from "viem";
import { CHAIN_ID, CHAIN_ID_HEX } from "../config";
import type { Eip1193Provider } from "./eip5792";

/**
 * Browser wallets, found through EIP-6963 so that several installed wallets
 * can each be offered by name. A wallet that predates the standard and only
 * sets window.ethereum is offered as "Browser wallet".
 */
export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: Eip1193Provider;
}

interface WalletState {
  options: WalletOption[];
  /** The connected wallet, if any. */
  active?: WalletOption;
  account?: Address;
  chainId?: number;
  connecting: boolean;
  pickerOpen: boolean;
  error?: string;
}

const LAST_WALLET_KEY = "sv-vault.wallet";

export const wallet = reactive<WalletState>({
  options: [],
  connecting: false,
  pickerOpen: false,
});

const remember = (id?: string) => {
  try {
    if (id) localStorage.setItem(LAST_WALLET_KEY, id);
    else localStorage.removeItem(LAST_WALLET_KEY);
  } catch {
    // Storage blocked: the wallet just will not be remembered.
  }
};

const remembered = (): string | null => {
  try {
    return localStorage.getItem(LAST_WALLET_KEY);
  } catch {
    return null;
  }
};

const toAccount = (accounts: unknown): Address | undefined => {
  const first = Array.isArray(accounts) ? accounts[0] : undefined;
  return typeof first === "string" ? getAddress(first) : undefined;
};

const onAccountsChanged = (accounts: unknown) => {
  wallet.account = toAccount(accounts);
  if (!wallet.account) disconnect();
};

const onChainChanged = (chainId: unknown) => {
  wallet.chainId = Number(chainId);
};

const attach = async (option: WalletOption, accounts: unknown) => {
  wallet.active = option;
  wallet.account = toAccount(accounts);
  wallet.chainId = Number(await option.provider.request({ method: "eth_chainId" }));
  option.provider.on?.("accountsChanged", onAccountsChanged);
  option.provider.on?.("chainChanged", onChainChanged);
  remember(option.id);
};

export const connect = async (option: WalletOption) => {
  wallet.connecting = true;
  wallet.error = undefined;
  try {
    const accounts = await option.provider.request({ method: "eth_requestAccounts" });
    await attach(option, accounts);
    wallet.pickerOpen = false;
  } catch (error: any) {
    // 4001 is the user closing the wallet's prompt: not worth a message.
    if (error?.code !== 4001) {
      wallet.error = "Could not connect to that wallet. Unlock it and try again.";
      // Shown inside the picker, which a single-wallet connect never opened.
      wallet.pickerOpen = true;
    }
  } finally {
    wallet.connecting = false;
  }
};

/** One wallet installed: connect to it. Several: let the visitor choose. */
export const openConnect = () => {
  wallet.error = undefined;
  if (wallet.options.length === 1) {
    void connect(wallet.options[0]);
    return;
  }
  wallet.pickerOpen = true;
};

export const disconnect = () => {
  wallet.active?.provider.removeListener?.("accountsChanged", onAccountsChanged);
  wallet.active?.provider.removeListener?.("chainChanged", onChainChanged);
  wallet.active = undefined;
  wallet.account = undefined;
  wallet.chainId = undefined;
  remember(undefined);
};

/**
 * Reconnect to the wallet used last time, without a prompt: eth_accounts
 * only answers with accounts the wallet has already shared with this site.
 */
const restore = async (option: WalletOption) => {
  if (wallet.active || remembered() !== option.id) return;
  try {
    const accounts = await option.provider.request({ method: "eth_accounts" });
    if (toAccount(accounts)) await attach(option, accounts);
  } catch {
    // Locked or unavailable: stay disconnected.
  }
};

const addOption = (option: WalletOption) => {
  if (wallet.options.some((known) => known.id === option.id)) return;
  wallet.options.push(option);
  void restore(option);
};

export const discoverWallets = () => {
  window.addEventListener("eip6963:announceProvider", (event: Event) => {
    const detail = (event as CustomEvent).detail;
    if (!detail?.provider || !detail?.info) return;
    addOption({
      id: detail.info.rdns || detail.info.uuid,
      name: detail.info.name,
      icon: detail.info.icon,
      provider: detail.provider,
    });
  });
  window.dispatchEvent(new Event("eip6963:requestProvider"));

  // Wallets announce synchronously on request. If none did, fall back to the
  // legacy global after a moment (in-app browsers often inject it late).
  setTimeout(() => {
    const legacy = (window as any).ethereum as Eip1193Provider | undefined;
    if (wallet.options.length === 0 && legacy) {
      addOption({ id: "window.ethereum", name: "Browser wallet", provider: legacy });
    }
  }, 400);
};

export class WrongNetworkError extends Error {
  constructor() {
    super("Switch your wallet to Ethereum to continue.");
  }
}

/** Ask the wallet to be on Ethereum before it is asked to sign. */
export const ensureMainnet = async () => {
  const provider = wallet.active?.provider;
  if (!provider) throw new Error("No wallet connected.");
  const current = Number(await provider.request({ method: "eth_chainId" }));
  if (current === CHAIN_ID) return;
  try {
    await provider.request({
      method: "wallet_switchEthereumChain",
      params: [{ chainId: CHAIN_ID_HEX }],
    });
  } catch {
    throw new WrongNetworkError();
  }
  wallet.chainId = Number(await provider.request({ method: "eth_chainId" }));
  if (wallet.chainId !== CHAIN_ID) throw new WrongNetworkError();
};

/** Send one transaction from the connected account; resolves with its hash. */
export const sendTransaction = async (call: {
  to: Address;
  data: Hex;
  value: bigint;
}): Promise<Hex> => {
  const provider = wallet.active?.provider;
  if (!provider || !wallet.account) throw new Error("No wallet connected.");
  return provider.request({
    method: "eth_sendTransaction",
    params: [
      {
        from: wallet.account,
        to: call.to,
        data: call.data,
        // Omitted when zero: some wallets show "0 ETH" as a transfer otherwise.
        ...(call.value > 0n ? { value: numberToHex(call.value) } : {}),
      },
    ],
  });
};

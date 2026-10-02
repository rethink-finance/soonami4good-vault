/**
 * A stand-in browser wallet for rehearsing the page against a local fork.
 * Development only: main.ts loads this file behind import.meta.env.DEV, so a
 * production build contains none of it.
 *
 *   anvil --fork-url <mainnet rpc> --port 8546 --auto-impersonate --chain-id 1
 *   VITE_RPC_URL=http://127.0.0.1:8546 npx vite
 *   open http://localhost:5173/?mock=0x<any address funded on the fork>
 *
 * It signs nothing: the fork accepts transactions from any address. Switches
 * for trying the awkward paths, set from the browser console:
 *   __mock.reject = true      the "user" declines every confirmation
 *   __mock.batch = true       the wallet claims EIP-5792 atomic batching
 *   __mock.chainId = "0xa"    the wallet sits on another network
 *   __mock.refuseSwitch = true  ...and refuses to leave it
 */
interface MockSwitches {
  reject: boolean;
  batch: boolean;
  chainId: string;
  refuseSwitch: boolean;
  log: { method: string; params?: unknown }[];
}

const rpcError = (message: string, code: number) => Object.assign(new Error(message), { code });

export const announceMockWallet = (account: string, rpcUrl: string) => {
  const switches: MockSwitches = {
    reject: false,
    batch: false,
    chainId: "0x1",
    refuseSwitch: false,
    log: [],
  };
  (window as any).__mock = switches;

  let id = 0;
  const rpc = async (method: string, params: unknown) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params }),
    });
    const body = await response.json();
    if (body.error) throw rpcError(body.error.message, body.error.code);
    return body.result;
  };

  const batches: Record<string, string[]> = {};
  const declineIfAsked = () => {
    if (switches.reject) throw rpcError("User rejected the request.", 4001);
  };

  const provider = {
    async request({ method, params }: { method: string; params?: any }) {
      switches.log.push({ method, params });
      switch (method) {
        case "eth_requestAccounts":
        case "eth_accounts":
          return [account];
        case "eth_chainId":
          return switches.chainId;
        case "wallet_switchEthereumChain":
          if (switches.refuseSwitch) throw rpcError("User rejected the request.", 4001);
          switches.chainId = params[0].chainId;
          return null;
        case "wallet_getCapabilities":
          if (!switches.batch) throw rpcError("Method not found", -32601);
          return { "0x1": { atomic: { status: "supported" } } };
        case "wallet_sendCalls": {
          declineIfAsked();
          // Not atomic like a real smart account, but the fork mines each call
          // at once, which is enough to rehearse the page's side of a batch.
          const hashes: string[] = [];
          for (const call of params[0].calls) {
            hashes.push(await rpc("eth_sendTransaction", [{ from: account, ...call }]));
          }
          const batchId = `0xbatch${Date.now()}`;
          batches[batchId] = hashes;
          return { id: batchId };
        }
        case "wallet_getCallsStatus": {
          const receipts = await Promise.all(
            batches[params[0]].map((hash) => rpc("eth_getTransactionReceipt", [hash])),
          );
          if (receipts.some((receipt) => !receipt)) return { status: 100 };
          const ok = receipts.every((receipt) => receipt.status === "0x1");
          return { status: ok ? 200 : 500, receipts };
        }
        case "eth_sendTransaction":
          declineIfAsked();
          return rpc(method, params);
        default:
          return rpc(method, params);
      }
    },
    on() {},
    removeListener() {},
  };

  const announce = () =>
    window.dispatchEvent(
      new CustomEvent("eip6963:announceProvider", {
        detail: Object.freeze({
          info: { uuid: "mock", name: "Mock wallet (fork)", icon: "", rdns: "dev.mock" },
          provider,
        }),
      }),
    );
  window.addEventListener("eip6963:requestProvider", announce);
  announce();
};

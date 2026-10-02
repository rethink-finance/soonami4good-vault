# Scientific Vote Vault

The deposit page for the [Scientific Vote Vault](https://app.rethink.finance/details/0x1-sciETH-0x2741408077cd7C7D3943D0142bafAE28c97EAA35)
(sciETH, Ethereum), served at **https://soonami4good.rethink.finance**. A stripped-down
version of the vault's Rethink page in the [Scientific Vote](https://scientificvote.soonami4good.eth.limo/)
brand: deposit ETH, redeem, and the facts a depositor should know. Nothing else.

It talks to the vault directly from the browser (viem, public RPCs, no backend) and
implements the vault's own flows:

- **Deposit**: wrap ETH to WETH → `requestDeposit` → approve → delegate votes to self →
  `deposit()` once a valuation made after the request exists (straight away before the
  vault's first valuation). Wallets with EIP-5792 batching get it as one confirmation.
- **Redeem**: `requestWithdraw` → `withdraw()` once a valuation follows and the vault
  contract holds the WETH to pay it.
- Open requests are read from the vault's storage, so a page reloaded halfway through a
  flow shows exactly what is left to sign.

Addresses and the vault's settings are checked against `getFundSettings()` on every
refresh; if governance ever changes the base token, Safe or voting token, the page stops
sending.

## Develop

```bash
npm install
npm run dev        # http://localhost:5183, reads mainnet
npm test           # unit tests
npm run typecheck
```

## Rehearse against a fork

Real transactions, no real money. Needs [foundry](https://getfoundry.sh).

```bash
anvil --fork-url https://mainnet.gateway.tenderly.co --port 8546 --auto-impersonate --chain-id 1
VITE_RPC_URL=http://127.0.0.1:8546 npx vitest run src/chain/fork.e2e.test.ts   # the whole life cycle
VITE_RPC_URL=http://127.0.0.1:8546 npx vite                                    # the page, reading the fork
```

Open `http://localhost:5183/?mock=0x<address>` to get a stand-in wallet for that address
(fund it first with `anvil_setBalance`). `window.__mock` has switches for the awkward
paths: `reject`, `batch`, `chainId`, `refuseSwitch`. See `src/dev/mockWallet.ts`. None of
this is in a production build.

## Deploy

GitHub Pages, from the **[PRODUCTION] Deploy to GitHub Pages** workflow
(`workflow_dispatch` only, like the other Rethink deploys):

```bash
gh workflow run deploy.yml --repo rethink-finance/soonami4good-vault --ref main
```

DNS: `soonami4good.rethink.finance` is a CNAME to `rethink-finance.github.io`, DNS-only
(grey cloud) in Cloudflare so GitHub can issue the certificate.

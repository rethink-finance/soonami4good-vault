<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import {
  ADDRESSES,
  EXPLORER_URL,
  RETHINK_VAULT_URL,
  SCIENTIFIC_VOTE_URL,
  SOONAMI_URL,
} from "./config";
import { sharePrice } from "./chain/math";
import VaultCard from "./components/VaultCard.vue";
import WalletPicker from "./components/WalletPicker.vue";
import { fmtBps, fmtRounded, shortAddress } from "./format";
import { startRefreshing, store } from "./useVault";
import { disconnect, discoverWallets, openConnect, wallet } from "./wallet/wallet";

onMounted(() => {
  discoverWallets();
  startRefreshing();
});

const accountMenuOpen = ref(false);

const vault = computed(() => store.vault);

const totalDeposited = computed(() => (vault.value ? `${fmtRounded(vault.value.totalNav)} ETH` : "…"));
const price = computed(() =>
  vault.value ? `1 sciETH = ${fmtRounded(sharePrice(vault.value))} ETH` : "…",
);
const fees = computed(() => {
  if (!vault.value) return "…";
  const { depositFeeBps, withdrawFeeBps } = vault.value;
  if (depositFeeBps === 0n && withdrawFeeBps === 0n) return "None";
  return `${fmtBps(depositFeeBps)} in, ${fmtBps(withdrawFeeBps)} out`;
});

const contracts = [
  { name: "Vault and sciETH token", address: ADDRESSES.vault },
  { name: "Custody Safe", address: ADDRESSES.safe },
  { name: "Operator permissions", address: ADDRESSES.rolesModifier },
  { name: "Depositor governance", address: ADDRESSES.governor },
  { name: "Scientific Vote multisig", address: ADDRESSES.yieldMultisig },
];
</script>

<template>
  <header class="site-header">
    <a class="brand" href="#top" aria-label="Scientific Vote Vault">
      <span class="brand-mark">SV</span>
      <span>Scientific Vote Vault</span>
    </a>
    <nav class="site-nav" aria-label="Main">
      <a class="nav-link" href="#how">How it works</a>
      <a class="nav-link" href="#safeguards">Safeguards</a>
      <a class="nav-link" href="#contracts">Contracts</a>
      <div v-if="wallet.account" class="account">
        <button class="nav-cta" :aria-expanded="accountMenuOpen" @click="accountMenuOpen = !accountMenuOpen">
          <span class="status-dot" aria-hidden="true" />
          {{ shortAddress(wallet.account) }}
        </button>
        <div v-if="accountMenuOpen" class="account-menu">
          <p class="mono-label">{{ wallet.active?.name }}</p>
          <button
            class="link-button"
            @click="
              disconnect();
              accountMenuOpen = false;
            "
          >
            Disconnect
          </button>
        </div>
      </div>
      <button v-else class="nav-cta" :disabled="wallet.connecting" @click="openConnect">
        Connect wallet
      </button>
    </nav>
  </header>

  <main id="top">
    <section class="hero">
      <div class="eyebrow">
        <span class="status-dot" aria-hidden="true" />
        soonami4good · Scientific Vote Vault · Ethereum
      </div>

      <div class="hero-grid">
        <div>
          <h1>Your ETH stays yours. Its yield funds Scientific Vote.</h1>
          <p class="hero-lede">
            Deposit ETH into the Scientific Vote Vault. It is staked in native Ethereum validators,
            and all staking yield goes to
            <a :href="SCIENTIFIC_VOTE_URL" target="_blank" rel="noopener">Scientific Vote</a>. Your
            principal is never spent, and you can ask for it back whenever you like.
          </p>
        </div>
        <VaultCard />
      </div>

      <div class="hero-index" aria-label="Vault figures">
        <div>
          <span class="mono-label">In the vault</span>
          <strong>{{ totalDeposited }}</strong>
        </div>
        <div>
          <span class="mono-label">Share price</span>
          <strong>{{ price }}</strong>
        </div>
        <div>
          <span class="mono-label">Fees</span>
          <strong>{{ fees }}</strong>
        </div>
        <div>
          <span class="mono-label">Settlement</span>
          <strong>Within 2 weeks</strong>
        </div>
      </div>
    </section>

    <section id="how" class="section-pad">
      <p class="section-number">01 / How it works</p>
      <div class="section-heading">
        <h2>Deposit, stake, fund, redeem.</h2>
        <p>Four steps. Each one happens on Ethereum, where anyone can check it.</p>
      </div>

      <div class="steps">
        <article class="step">
          <div class="step-number">01</div>
          <div>
            <p class="mono-label">Deposit</p>
            <h3>Put ETH in and receive sciETH</h3>
            <p>
              Choose an amount and confirm in your wallet. Deposits settle at the vault's next
              valuation, usually within two weeks, and you receive one sciETH for each ETH. Until
              then it stays in your own wallet, wrapped as WETH.
            </p>
            <div class="tags"><span>No fees</span><span>1 sciETH = 1 ETH</span></div>
          </div>
        </article>
        <article class="step">
          <div class="step-number">02</div>
          <div>
            <p class="mono-label">Stake</p>
            <h3>The vault stakes it with Ethereum validators</h3>
            <p>
              Deposited ETH is staked in native Ethereum validators. ETH that is waiting for a
              validator can be held as Lido stETH in the meantime.
            </p>
            <div class="tags"><span>Native staking</span><span>Held in a Safe</span></div>
          </div>
        </article>
        <article class="step">
          <div class="step-number">03</div>
          <div>
            <p class="mono-label">Fund</p>
            <h3>All staking yield goes to Scientific Vote</h3>
            <p>
              Rewards are sent to the Scientific Vote multisig and pay for running the project.
              Depositors do not earn yield: sciETH stays worth the ETH you put in.
            </p>
            <div class="tags"><span>Yield only</span><span>Principal untouched</span></div>
          </div>
        </article>
        <article class="step">
          <div class="step-number">04</div>
          <div>
            <p class="mono-label">Redeem</p>
            <h3>Ask for your ETH back at any time</h3>
            <p>
              Request a redemption and withdraw after the vault's next valuation. Staked ETH has to
              leave the Ethereum validator exit queue first, so larger withdrawals can take longer.
            </p>
            <div class="tags"><span>Request any time</span><span>Paid in WETH</span></div>
          </div>
        </article>
      </div>
    </section>

    <section id="safeguards" class="section-pad safeguards">
      <p class="section-number">02 / Safeguards</p>
      <div class="section-heading">
        <h2>Be precise about where trust remains.</h2>
        <p>The rules are enforced by contracts, not by promises. Here is what they allow.</p>
      </div>

      <div class="trust-grid">
        <article class="trust-card">
          <p class="mono-label">T1 · Who holds the ETH?</p>
          <h3>A Safe with a fixed list of allowed actions.</h3>
          <p>
            Deposits are held by a Safe that belongs to the vault. The operator acts through a
            permissions module that lists exactly what it may do.
          </p>
          <ul>
            <li>Stake and unstake with the vault's validators</li>
            <li>Convert between ETH, WETH and stETH</li>
            <li>Send yield to the Scientific Vote multisig, capped at 5 ETH per 30 days</li>
            <li>Return WETH to the vault to pay redemptions, and record its valuation</li>
          </ul>
        </article>
        <article class="trust-card trust-crypto">
          <p class="mono-label">T2 · Who can change the rules?</p>
          <h3>Depositors, by vote.</h3>
          <p>
            sciETH is the vault's voting token. Changing the vault's settings or the operator's
            permissions takes a proposal that depositors pass.
          </p>
          <ul>
            <li>Quorum of 50% of all sciETH</li>
            <li>About 10 days of voting, after a 1 day delay</li>
            <li>32 sciETH needed to propose</li>
            <li>Depositing here turns on your voting power</li>
          </ul>
        </article>
      </div>
      <p class="risk-note">
        Staking and smart contracts carry risk: validators can be penalised and contracts can have
        flaws. Deposit only what you are comfortable having staked.
      </p>
    </section>

    <section id="contracts" class="section-pad contracts">
      <p class="section-number">03 / Contracts</p>
      <div class="section-heading">
        <h2>Check it yourself.</h2>
        <p>
          Everything the vault does is on Ethereum. The full record, including every valuation and
          proposal, is on
          <a :href="RETHINK_VAULT_URL" target="_blank" rel="noopener">the vault's Rethink page</a>.
        </p>
      </div>
      <ul class="contract-list">
        <li v-for="contract in contracts" :key="contract.address">
          <span>{{ contract.name }}</span>
          <a
            :href="`${EXPLORER_URL}/address/${contract.address}`"
            target="_blank"
            rel="noopener"
            class="mono"
          >
            <span class="address-full">{{ contract.address }}</span>
            <span class="address-short">{{ shortAddress(contract.address) }}</span>
            ↗
          </a>
        </li>
      </ul>
    </section>
  </main>

  <footer class="site-footer">
    <div class="footer-brand">
      <strong>Scientific Vote Vault</strong>
      <p>A <a :href="SOONAMI_URL" target="_blank" rel="noopener">soonami4good</a> initiative.</p>
    </div>
    <p>
      <a :href="SCIENTIFIC_VOTE_URL" target="_blank" rel="noopener">About Scientific Vote ↗</a>
    </p>
    <p class="footer-tech">
      Runs on
      <strong><a href="https://rethink.finance" target="_blank" rel="noopener">Rethink Finance</a></strong>
    </p>
  </footer>

  <WalletPicker />
</template>

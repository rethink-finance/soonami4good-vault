<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { GAS_RESERVE_WEI } from "../config";
import {
  depositProblem,
  depositStatus,
  redeemProblem,
  redeemStatus,
  remainingDepositSteps,
  wrapNeeded,
} from "../chain/flows";
import { sharesForDeposit, valueForRedemption } from "../chain/math";
import { fmtAmount, fmtBps, fmtDate, fmtRounded, parseAmount, toInput } from "../format";
import { actions, dismissRun, store } from "../useVault";
import { openConnect, wallet } from "../wallet/wallet";
import RunProgress from "./RunProgress.vue";

const tab = ref<"deposit" | "redeem">("deposit");
const depositInput = ref("");
const redeemInput = ref("");

const vault = computed(() => store.vault);
const user = computed(() => store.user);
const connected = computed(() => Boolean(wallet.account));
const busy = computed(() => Boolean(store.run?.active));
const blocked = computed(() => busy.value || store.mismatch);

// A finished run's message belongs to the tab it happened on.
watch(tab, dismissRun);

/* ---------- Deposit ---------- */

const depositAmount = computed(() => parseAmount(depositInput.value));

/** WETH already held, plus ETH that can be wrapped while leaving gas money. */
const depositable = computed(() => {
  if (!user.value) return 0n;
  const spareEth = user.value.eth > GAS_RESERVE_WEI ? user.value.eth - GAS_RESERVE_WEI : 0n;
  return user.value.weth + spareEth;
});

const depositIssue = computed(() => {
  if (!user.value || !vault.value || !depositAmount.value) return undefined;
  return depositProblem(depositAmount.value, user.value, vault.value);
});

const sharesOut = computed(() =>
  vault.value && depositAmount.value ? sharesForDeposit(depositAmount.value, vault.value) : undefined,
);

const toWrap = computed(() =>
  user.value && depositAmount.value ? wrapNeeded(depositAmount.value, user.value) : 0n,
);

const dStatus = computed(() =>
  user.value && vault.value ? depositStatus(user.value, vault.value) : "none",
);
const dSteps = computed(() =>
  user.value && vault.value ? remainingDepositSteps(user.value, vault.value) : [],
);
/** While a request waits, the one thing that can still be signed is the vote delegation. */
const canEnableVoting = computed(
  () => dStatus.value === "waiting" && dSteps.value.some((step) => step.id === "delegate"),
);

const settlesNow = computed(() => vault.value?.lastNavUpdateTime === 0n);

const depositFee = computed(() =>
  !vault.value ? "…" : vault.value.depositFeeBps === 0n ? "None" : fmtBps(vault.value.depositFeeBps),
);
const redeemFee = computed(() =>
  !vault.value ? "…" : vault.value.withdrawFeeBps === 0n ? "None" : fmtBps(vault.value.withdrawFeeBps),
);

const depositCta = computed(() => {
  if (!connected.value) return "Connect wallet";
  if (!user.value || !vault.value) return "Loading…";
  if (!depositAmount.value) return "Enter an amount";
  return depositIssue.value ?? "Deposit";
});
const depositDisabled = computed(() => {
  if (!connected.value) return false;
  return blocked.value || depositCta.value !== "Deposit";
});

const submitDeposit = async () => {
  if (!connected.value) return openConnect();
  if (depositDisabled.value || !depositAmount.value) return;
  await actions.deposit(depositAmount.value);
  if (store.run?.success) depositInput.value = "";
};

/* ---------- Redeem ---------- */

/**
 * sciETH is minted in parts per billion, so a 3.5 ETH deposit holds
 * 3.499999997 sciETH and reads as "3.5". Someone typing the balance they see
 * means all of it: an amount over the balance by less than the display can
 * show is taken as the whole balance.
 */
const DISPLAY_DUST = 10n ** 12n;
const redeemAmount = computed(() => {
  const typed = parseAmount(redeemInput.value);
  const held = user.value?.shares;
  if (typed === undefined || held === undefined) return typed;
  return typed > held && typed - held < DISPLAY_DUST ? held : typed;
});

const redeemIssue = computed(() => {
  if (!user.value || !redeemAmount.value) return undefined;
  return redeemProblem(redeemAmount.value, user.value);
});

const wethOut = computed(() =>
  vault.value && redeemAmount.value ? valueForRedemption(redeemAmount.value, vault.value) : undefined,
);

const rStatus = computed(() =>
  user.value && vault.value ? redeemStatus(user.value, vault.value) : "none",
);
const openRedeemValue = computed(() =>
  user.value && vault.value ? valueForRedemption(user.value.redeemRequest.amount, vault.value) : 0n,
);

const redeemCta = computed(() => {
  if (!connected.value) return "Connect wallet";
  if (!user.value || !vault.value) return "Loading…";
  if (user.value.shares === 0n) return "No sciETH in this wallet";
  if (!redeemAmount.value) return "Enter an amount";
  return redeemIssue.value ?? "Request redemption";
});
const redeemDisabled = computed(() => {
  if (!connected.value) return false;
  return blocked.value || redeemCta.value !== "Request redemption";
});

const submitRedeem = async () => {
  if (!connected.value) return openConnect();
  if (redeemDisabled.value || !redeemAmount.value) return;
  await actions.requestRedeem(redeemAmount.value);
  if (store.run?.success) redeemInput.value = "";
};

// "Come back after the next valuation" is stale once that valuation arrives.
watch([dStatus, rStatus], () => {
  if (!busy.value) dismissRun();
});

/** WETH left in the wallet after a redemption, when no deposit is waiting on it. */
const unwrappable = computed(() =>
  user.value && user.value.depositRequest.amount === 0n ? user.value.weth : 0n,
);
</script>

<template>
  <section class="vault-card" aria-label="Deposit and redeem">
    <div v-if="user && user.shares > 0n" class="position">
      <span class="mono-label">Your deposit</span>
      <strong>{{ fmtRounded(user.shares) }} sciETH</strong>
    </div>

    <div class="tabs" role="tablist">
      <button
        role="tab"
        :aria-selected="tab === 'deposit'"
        :class="{ 'is-active': tab === 'deposit' }"
        @click="tab = 'deposit'"
      >
        Deposit
      </button>
      <button
        role="tab"
        :aria-selected="tab === 'redeem'"
        :class="{ 'is-active': tab === 'redeem' }"
        @click="tab = 'redeem'"
      >
        Redeem
      </button>
    </div>

    <!-- Deposit -->
    <div v-if="tab === 'deposit'" role="tabpanel" class="panel">
      <template v-if="user && dStatus !== 'none'">
        <p class="mono-label request-label">
          Deposit request · {{ fmtDate(user.depositRequest.time) }}
        </p>
        <p class="request-amount">{{ fmtAmount(user.depositRequest.amount) }} <span>ETH</span></p>

        <!-- While the wallet is working, the step list below tells the story. -->
        <template v-if="!busy">
        <p v-if="dStatus === 'ready'" class="status status-ready">
          Ready. Complete your deposit to receive sciETH.
        </p>
        <p v-else-if="dStatus === 'waiting'" class="status">
          Waiting for the vault's next valuation, usually within 2 weeks. Keep
          {{ fmtAmount(user.depositRequest.amount) }} WETH in this wallet until then, and come back
          here to complete the deposit.
        </p>
        <p v-else-if="dStatus === 'setup'" class="status">
          A few steps are left before this request can settle.
        </p>
        <p v-else class="status status-warn">
          This wallet no longer holds the {{ fmtAmount(user.depositRequest.amount) }} WETH this
          request is for. Top it up, or cancel the request.
        </p>

        <button
          v-if="dStatus === 'ready' || dStatus === 'setup'"
          class="button button-primary cta"
          :disabled="blocked"
          @click="actions.continueDeposit()"
        >
          {{ dStatus === "ready" ? "Complete deposit" : "Continue" }}
        </button>
        <button
          v-else-if="canEnableVoting"
          class="button button-secondary cta"
          :disabled="blocked"
          @click="actions.continueDeposit()"
        >
          Enable voting
        </button>
        <button class="link-button" :disabled="blocked" @click="actions.cancelDeposit()">
          Cancel request
        </button>
        </template>
      </template>

      <template v-else>
        <div class="field-head">
          <label class="mono-label" for="deposit-amount">Amount</label>
          <span v-if="user" class="balance">
            Available {{ fmtAmount(depositable) }} ETH
            <button class="max" :disabled="blocked" @click="depositInput = toInput(depositable)">
              Max
            </button>
          </span>
        </div>
        <div class="field">
          <input
            id="deposit-amount"
            v-model="depositInput"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.0"
            :disabled="blocked"
            @keydown.enter="submitDeposit"
          />
          <span class="unit">ETH</span>
        </div>

        <dl class="facts">
          <div>
            <dt>You receive</dt>
            <dd>{{ sharesOut !== undefined ? `≈ ${fmtRounded(sharesOut)}` : "0" }} sciETH</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>{{ depositFee }}</dd>
          </div>
          <div>
            <dt>Settlement</dt>
            <dd>{{ settlesNow ? "Right away" : "Within 2 weeks" }}</dd>
          </div>
        </dl>

        <button class="button button-primary cta" :disabled="depositDisabled" @click="submitDeposit">
          {{ depositCta }}
        </button>
        <p v-if="toWrap > 0n && !depositIssue" class="hint">
          Includes wrapping {{ fmtAmount(toWrap) }} ETH into WETH, the token the vault holds.
        </p>
      </template>
    </div>

    <!-- Redeem -->
    <div v-else role="tabpanel" class="panel">
      <template v-if="user && rStatus !== 'none'">
        <p class="mono-label request-label">
          Redemption request · {{ fmtDate(user.redeemRequest.time) }}
        </p>
        <p class="request-amount">{{ fmtRounded(user.redeemRequest.amount) }} <span>sciETH</span></p>

        <template v-if="!busy">
        <p v-if="rStatus === 'ready'" class="status status-ready">
          Ready. Withdraw to receive about {{ fmtRounded(openRedeemValue) }} WETH.
        </p>
        <p v-else-if="rStatus === 'unfunded'" class="status">
          The vault is setting aside the WETH to pay this out. If ETH has to be unstaked first,
          that follows the Ethereum validator exit queue and can take a few days.
        </p>
        <p v-else class="status">
          Waiting for the vault's next valuation, usually within 2 weeks. Come back here to
          withdraw.
        </p>

        <button
          v-if="rStatus === 'ready'"
          class="button button-primary cta"
          :disabled="blocked"
          @click="actions.withdraw()"
        >
          Withdraw
        </button>
        <button class="link-button" :disabled="blocked" @click="actions.cancelRedeem()">
          Cancel request
        </button>
        </template>
      </template>

      <template v-else>
        <div class="field-head">
          <label class="mono-label" for="redeem-amount">Amount</label>
          <span v-if="user" class="balance">
            Balance {{ fmtRounded(user.shares) }} sciETH
            <button
              class="max"
              :disabled="blocked || user.shares === 0n"
              @click="redeemInput = toInput(user.shares)"
            >
              Max
            </button>
          </span>
        </div>
        <div class="field">
          <input
            id="redeem-amount"
            v-model="redeemInput"
            inputmode="decimal"
            autocomplete="off"
            placeholder="0.0"
            :disabled="blocked"
            @keydown.enter="submitRedeem"
          />
          <span class="unit">sciETH</span>
        </div>

        <dl class="facts">
          <div>
            <dt>You receive</dt>
            <dd>{{ wethOut !== undefined ? `≈ ${fmtRounded(wethOut)}` : "0" }} WETH</dd>
          </div>
          <div>
            <dt>Fees</dt>
            <dd>{{ redeemFee }}</dd>
          </div>
          <div>
            <dt>Settlement</dt>
            <dd>Within 2 weeks</dd>
          </div>
        </dl>

        <button class="button button-primary cta" :disabled="redeemDisabled" @click="submitRedeem">
          {{ redeemCta }}
        </button>
      </template>

      <p v-if="unwrappable > 0n" class="hint">
        This wallet holds {{ fmtAmount(unwrappable) }} WETH.
        <button class="inline-link" :disabled="blocked" @click="actions.unwrap(unwrappable)">
          Unwrap it to ETH
        </button>
      </p>
    </div>

    <RunProgress v-if="store.run" :run="store.run" @dismiss="dismissRun" />

    <p v-if="store.loadError" class="status status-warn load-error">{{ store.loadError }}</p>
  </section>
</template>

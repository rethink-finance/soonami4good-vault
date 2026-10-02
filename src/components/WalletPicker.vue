<script setup lang="ts">
import { connect, wallet } from "../wallet/wallet";

const close = () => {
  wallet.pickerOpen = false;
};
</script>

<template>
  <div v-if="wallet.pickerOpen" class="picker-backdrop" @click.self="close" @keydown.esc="close">
    <div class="picker" role="dialog" aria-modal="true" aria-labelledby="picker-title">
      <div class="picker-head">
        <p id="picker-title" class="mono-label">Connect a wallet</p>
        <button class="picker-close" aria-label="Close" @click="close">×</button>
      </div>

      <ul v-if="wallet.options.length" class="picker-list">
        <li v-for="option in wallet.options" :key="option.id">
          <button :disabled="wallet.connecting" @click="connect(option)">
            <img v-if="option.icon" :src="option.icon" alt="" width="28" height="28" />
            <span v-else class="picker-icon" aria-hidden="true" />
            {{ option.name }}
          </button>
        </li>
      </ul>
      <p v-else class="picker-empty">
        No wallet found in this browser. Install a wallet such as MetaMask or Rabby, or open this
        page in your mobile wallet's browser, then reload.
      </p>

      <p v-if="wallet.error" class="status status-warn">{{ wallet.error }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Run, StepStatus } from "../useVault";

defineProps<{ run: Run }>();
defineEmits<{ dismiss: [] }>();

const STATUS_TEXT: Record<StepStatus, string> = {
  todo: "",
  signing: "Confirm in your wallet",
  pending: "Confirming on Ethereum",
  done: "Done",
};
</script>

<template>
  <div class="run" aria-live="polite">
    <p v-if="run.batched && run.active" class="mono-label run-title">
      One confirmation covers every step
    </p>
    <ol v-if="run.steps.length > 1 || run.active" class="run-steps">
      <li v-for="step in run.steps" :key="step.id" :class="`is-${step.status}`">
        <span class="run-mark" aria-hidden="true">
          <template v-if="step.status === 'done'">✓</template>
          <i v-else-if="step.status !== 'todo'" class="spinner" />
        </span>
        <span class="run-label">{{ step.label }}</span>
        <span class="run-status">{{ STATUS_TEXT[step.status] }}</span>
      </li>
    </ol>

    <p v-if="run.success" class="status status-ready">{{ run.success }}</p>
    <p v-else-if="run.error" class="status status-warn">{{ run.error }}</p>
    <p v-else-if="run.notice" class="status">{{ run.notice }}</p>

    <button v-if="!run.active" class="link-button" @click="$emit('dismiss')">Dismiss</button>
  </div>
</template>

<script setup lang="ts">
import {
  IconBolt,
  IconCircleCheck,
  IconCrown,
  IconLogin2,
  IconUserCircle,
} from '@tabler/icons-vue';
import { computed } from 'vue';

import { resolvePlanLabel } from '../plan-display';

const props = withDefaults(
  defineProps<{
    dailyCount: number;
    dailyLimit?: number;
    signedIn?: boolean;
    pro?: boolean;
    busy?: boolean;
    accountEmail?: string;
    accountDisplayName?: string;
    planCode?: string;
  }>(),
  {
    dailyLimit: 10,
    signedIn: false,
    pro: false,
    busy: false,
    accountEmail: '',
    accountDisplayName: '',
    planCode: '',
  },
);

const emit = defineEmits<{ signIn: []; upgrade: [] }>();

const planLabel = computed(() => resolvePlanLabel(props.planCode, props.pro));
const accountPrimary = computed(
  () => props.accountDisplayName.trim() || props.accountEmail,
);
const accountSecondary = computed(() =>
  props.accountDisplayName.trim() ? props.accountEmail : '',
);
</script>

<template>
  <section
    class="plan-banner"
    aria-label="Current account and plan"
    :aria-busy="busy"
  >
    <div class="plan-banner__top">
      <span class="plan-banner__name">
        <IconBolt :size="17" aria-hidden="true" />
        {{ planLabel }}
      </span>
      <span v-if="busy" class="plan-banner__checking">Checking account…</span>
      <span v-else-if="signedIn" class="plan-banner__connected">
        <IconCircleCheck :size="16" aria-hidden="true" />
        Connected
      </span>
      <button
        v-else
        class="plan-banner__signin"
        type="button"
        @click="emit('signIn')"
      >
        <IconLogin2 :size="17" aria-hidden="true" />
        Sign in
      </button>
    </div>

    <div v-if="signedIn" class="plan-banner__account">
      <IconUserCircle :size="25" aria-hidden="true" />
      <span class="plan-banner__account-copy">
        <span>Google account</span>
        <strong :title="accountPrimary">{{ accountPrimary }}</strong>
        <small v-if="accountSecondary" :title="accountSecondary">
          {{ accountSecondary }}
        </small>
      </span>
    </div>

    <div v-if="!pro" class="plan-banner__usage">
      <span>{{ dailyCount }}/{{ dailyLimit }} prompts today</span>
      <div
        class="usage-track"
        role="progressbar"
        aria-label="Daily prompt usage"
        :aria-valuenow="dailyCount"
        aria-valuemin="0"
        :aria-valuemax="dailyLimit"
      >
        <span
          :style="{
            width: `${Math.min(100, (dailyCount / Math.max(1, dailyLimit)) * 100)}%`,
          }"
        />
      </div>
      <button
        v-if="!signedIn"
        class="plan-banner__upgrade"
        type="button"
        :disabled="busy"
        @click="emit('upgrade')"
      >
        <IconCrown :size="16" aria-hidden="true" />
        Sign in to manage your plan
      </button>
      <p v-if="!signedIn">Google sign-in is managed by PAKS.</p>
    </div>
  </section>
</template>

<script setup lang="ts">
import { IconDeviceDesktop, IconPlugConnected } from '@tabler/icons-vue';
import { onMounted, ref } from 'vue';

import { DESKTOP_ERROR_MESSAGES } from '../../desktop/contracts';
import { requestDesktopHello } from '../../desktop/messages';

type LinkState =
  | { kind: 'checking' }
  | { kind: 'connected'; appVersion: string; paired: boolean }
  | { kind: 'not-connected'; message: string };

const state = ref<LinkState>({ kind: 'checking' });
const busy = ref(false);

async function check(): Promise<void> {
  state.value = { kind: 'checking' };
  const reply = await requestDesktopHello();
  state.value = reply.ok
    ? { kind: 'connected', appVersion: reply.appVersion, paired: reply.paired }
    : { kind: 'not-connected', message: DESKTOP_ERROR_MESSAGES[reply.code] };
}

/** Asks Chrome for the native-messaging permission, then says hello. */
async function connect(): Promise<void> {
  busy.value = true;
  try {
    const granted = await chrome.permissions.request({
      permissions: ['nativeMessaging'],
    });
    if (!granted) {
      state.value = {
        kind: 'not-connected',
        message: 'Chrome did not allow the link. Nothing was changed.',
      };
      return;
    }
    await check();
  } finally {
    busy.value = false;
  }
}

onMounted(() => void check());
</script>

<template>
  <section class="desktop-link" aria-labelledby="desktop-link-title">
    <h2 id="desktop-link-title" class="desktop-link__title">
      <IconDeviceDesktop :size="17" aria-hidden="true" />
      Drama Studio desktop
    </h2>
    <p>
      Link the Companion to the Drama Studio app on this computer so it can hand
      prompts to AI sites and send results back to your project.
    </p>
    <span class="desktop-link__status" :data-state="state.kind" role="status">
      <template v-if="state.kind === 'checking'">Checking…</template>
      <template v-else-if="state.kind === 'connected'">
        Connected to Drama Studio {{ state.appVersion
        }}{{ state.paired ? '' : ' (allow this browser in the app)' }}
      </template>
      <template v-else>{{ state.message }}</template>
    </span>
    <div v-if="state.kind === 'not-connected'">
      <button
        class="button primary small"
        type="button"
        :disabled="busy"
        @click="connect"
      >
        <IconPlugConnected :size="15" aria-hidden="true" />
        Connect to Drama Studio
      </button>
    </div>
    <div v-else-if="state.kind === 'connected' && !state.paired">
      <button class="button small" type="button" @click="check">
        Check again
      </button>
    </div>
  </section>
</template>

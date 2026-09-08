<template>
  <Alert
    class="mb-4 rounded-xl border-border/60 bg-card/45 px-5 py-4 text-foreground"
    variant="default"
    :closable="true"
    v-if="shouldShow"
    id="enhance-experience"
    :allowDismissForever="true"
  >
    <AlertTitle class="mb-1.5 flex items-center gap-2 text-[13px] font-medium"><span class="flex items-center gap-2"><svg class="h-4 w-4 shrink-0 text-[hsl(var(--highlight))]" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><rect x="5" y="2" width="14" height="20" rx="3" /><path d="M10 18h4M12 6v7m-3-3 3 3 3-3" /></svg>AlphaPush, closer at hand</span></AlertTitle>
    <AlertDescription class="max-w-[56ch] text-xs leading-6 text-muted-foreground">{{ pwaInstallTip }}</AlertDescription>
  </Alert>
</template>

<script lang="ts" setup>
import { computed, onMounted, ref } from 'vue';

import Alert from '@/components/ui/alert/Alert.vue';
import AlertTitle from '@/components/ui/alert/AlertTitle.vue';
import AlertDescription from '@/components/ui/alert/AlertDescription.vue';

const props = defineProps<{
  isMobile: boolean;
}>();

const shouldShow = ref(false);

const pwaInstallTip = computed(() =>
  props.isMobile
    ? 'Add AlphaPush to your Home Screen for quick access and push notifications.'
    : "Install AlphaPush from your browser’s address bar or menu for a dedicated window and quick access.",
);

function checkPwaInstallation() {
  const isDismissed = localStorage.getItem('alert_enhance-experience_dismissed') === 'true';
  shouldShow.value = !window.matchMedia('(display-mode: standalone)').matches && !isDismissed;
}

onMounted(() => {
  checkPwaInstallation();
});
</script>

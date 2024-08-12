<template>
  <Alert class="mb-4" variant="warning" :closable="true" v-if="shouldShow">
    <AlertTitle class="mb-2 font-bold">Enhance Your Experience</AlertTitle>
    <AlertDescription>{{ pwaInstallTip }}</AlertDescription>
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
    ? 'For optimal performance and reliable push notifications, we recommend adding this app to your home screen.'
    : "For the best experience, we recommend using this app in a standalone window. Click the install button in your browser's address bar or menu to set it up.",
);

function checkPwaInstallation() {
  shouldShow.value = !window.matchMedia('(display-mode: standalone)').matches;
}

onMounted(() => {
  checkPwaInstallation();
});
</script>

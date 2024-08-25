<script setup lang="ts">
import { ref, computed, provide, onMounted } from 'vue';
import type { HTMLAttributes } from 'vue';
import { type AlertVariants, alertVariants } from '.';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  variant?: AlertVariants['variant'];
  closable?: boolean;
  allowDismissForever?: boolean;
  id?: string;
}>();

const isVisible = ref(true);
const showDismissForever = ref(false);

const closeAlert = () => {
  if (props.allowDismissForever) {
    showDismissForever.value = true;
  } else {
    isVisible.value = false;
  }
};

const dismissForever = () => {
  if (props.allowDismissForever && props.id) {
    isVisible.value = false;
    localStorage.setItem(`alert_${props.id}_dismissed`, 'true');
  }
};

const dismissTemporarily = () => {
  isVisible.value = false;
};

const closable = computed(() => props.closable);
const allowDismissForever = computed(() => props.allowDismissForever);

provide('closable', closable);
provide('closeAlert', closeAlert);
provide('showDismissForever', showDismissForever);
provide('dismissForever', dismissForever);
provide('dismissTemporarily', dismissTemporarily);
provide('allowDismissForever', allowDismissForever);

onMounted(() => {
  if (props.allowDismissForever && props.id) {
    const isDismissed = localStorage.getItem(`alert_${props.id}_dismissed`) === 'true';
    if (isDismissed) {
      isVisible.value = false;
    }
  }
});
</script>

<template>
  <div v-if="isVisible" :class="cn(alertVariants({ variant: props.variant }), props.class)" role="alert">
    <slot />
  </div>
</template>
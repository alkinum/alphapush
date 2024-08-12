<script setup lang="ts">
import { ref, computed, provide } from 'vue';
import type { HTMLAttributes } from 'vue';
import { type AlertVariants, alertVariants } from '.';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
  variant?: AlertVariants['variant'];
  closable?: boolean;
}>();

const isVisible = ref(true);

const closeAlert = () => {
  isVisible.value = false;
};

const closable = computed(() => props.closable);

provide('closable', closable);
provide('closeAlert', closeAlert);
</script>

<template>
  <div v-if="isVisible" :class="cn(alertVariants({ variant: props.variant }), props.class)" role="alert">
    <slot />
  </div>
</template>

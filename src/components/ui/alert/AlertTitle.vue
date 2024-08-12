<script setup lang="ts">
import { inject } from 'vue';
import type { ComputedRef, HTMLAttributes } from 'vue';
import { Icon } from '@iconify/vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();

const closable = inject<ComputedRef<boolean>>('closable');
const closeAlert = inject('closeAlert', () => {});
</script>

<template>
  <div :class="cn('relative flex items-center justify-between', props.class)">
    <h5 :class="cn(`${closable ? '' : 'mb-1 '}font-medium leading-none tracking-tight`)">
      <slot />
    </h5>
    <button v-if="closable" @click="closeAlert">
      <Icon icon="mdi:close" class="w-4 h-4" />
    </button>
  </div>
</template>

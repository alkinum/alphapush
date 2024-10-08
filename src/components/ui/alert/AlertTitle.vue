<script setup lang="ts">
import { inject, ref } from 'vue';
import type { ComputedRef, HTMLAttributes, Ref } from 'vue';
import { Icon } from '@iconify/vue';
import { cn } from '@/lib/utils';

const props = defineProps<{
  class?: HTMLAttributes['class'];
}>();

const closable = inject<ComputedRef<boolean>>('closable');
const closeAlert = inject('closeAlert', () => {});
const showDismissForever = inject<Ref<boolean>>('showDismissForever');
const dismissForever = inject('dismissForever', () => {});
const dismissTemporarily = inject('dismissTemporarily', () => {});
const allowDismissForever = inject<ComputedRef<boolean>>('allowDismissForever');
</script>

<template>
  <div :class="cn('relative flex items-center justify-between', props.class)">
    <h5 :class="cn(`${closable ? '' : 'mb-1 '}font-medium leading-none tracking-tight`)">
      <slot />
    </h5>
    <div v-if="closable" class="flex items-center">
      <template v-if="!showDismissForever || !allowDismissForever">
        <button @click="closeAlert">
          <Icon icon="mdi:close" class="w-4 h-4" />
        </button>
      </template>
      <template v-else-if="allowDismissForever">
        <span class="mr-2 text-sm font-semibold">Dismiss forever?</span>
        <button @click="dismissForever" class="mr-2 text-sm font-medium">Yes</button>
        <button @click="dismissTemporarily" class="text-sm font-medium">No</button>
      </template>
    </div>
  </div>
</template>

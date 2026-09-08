<script setup lang="ts">
import type { HTMLAttributes } from "vue"
import { cn } from '@/utils/shadcn'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()
</script>

<template>
  <div
    :class="
      cn(
        'app-surface rounded-xl border border-border/80 bg-card text-card-foreground',
        props.class,
      )
    "
  >
    <slot />
  </div>
</template>

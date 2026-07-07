<script setup lang="ts">
import type { PrimitiveProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed, useAttrs } from "vue"
import type { ButtonVariants } from "."
import { Primitive } from "reka-ui"
import { cn } from '@/utils/shadcn'
import { buttonVariants } from "."

defineOptions({
  inheritAttrs: false,
})

interface Props extends PrimitiveProps {
  variant?: ButtonVariants["variant"]
  size?: ButtonVariants["size"]
  class?: HTMLAttributes["class"]
}

const props = withDefaults(defineProps<Props>(), {
  as: "button",
})

const attrs = useAttrs()
const classes = computed(() => cn(buttonVariants({ variant: props.variant, size: props.size }), props.class))
</script>

<template>
  <Primitive
    v-if="asChild"
    v-bind="attrs"
    :as="as"
    :as-child="asChild"
    :class="classes"
  >
    <slot />
  </Primitive>
  <component
    :is="as"
    v-else
    v-bind="attrs"
    :class="classes"
  >
    <slot />
  </component>
</template>

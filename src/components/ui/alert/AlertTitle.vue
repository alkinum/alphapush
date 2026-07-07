<script setup lang="ts">
import type { ComputedRef, Ref } from "vue"
import { computed, inject } from "vue"
import type { HTMLAttributes } from "vue"
import { Icon } from "@iconify/vue"
import { cn } from '@/utils/shadcn'

const props = defineProps<{
  class?: HTMLAttributes["class"]
}>()

const closable = inject<ComputedRef<boolean | undefined>>("closable")
const closeAlert = inject("closeAlert", () => {})
const showDismissForever = inject<Ref<boolean>>("showDismissForever")
const dismissForever = inject("dismissForever", () => {})
const dismissTemporarily = inject("dismissTemporarily", () => {})
const allowDismissForever = inject<ComputedRef<boolean | undefined>>("allowDismissForever")

const isClosable = computed(() => closable?.value ?? false)
const isDismissForeverPromptVisible = computed(() => showDismissForever?.value ?? false)
const canDismissForever = computed(() => allowDismissForever?.value ?? false)
</script>

<template>
  <div :class="cn('relative flex items-center justify-between', props.class)">
    <h5 :class="cn(`${isClosable ? '' : 'mb-1 '}font-medium leading-none tracking-tight`)">
      <slot />
    </h5>
    <div v-if="isClosable" class="flex items-center">
      <template v-if="!isDismissForeverPromptVisible || !canDismissForever">
        <button type="button" aria-label="Close alert" @click="closeAlert">
          <Icon icon="mdi:close" class="h-4 w-4" />
        </button>
      </template>
      <template v-else>
        <span class="mr-2 text-sm font-semibold">Dismiss forever?</span>
        <button type="button" class="mr-2 text-sm font-medium" @click="dismissForever">
          Yes
        </button>
        <button type="button" class="text-sm font-medium" @click="dismissTemporarily">
          No
        </button>
      </template>
    </div>
  </div>
</template>

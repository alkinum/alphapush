<script setup lang="ts">
import type { CheckboxRootProps } from "reka-ui"
import type { HTMLAttributes } from "vue"
import { computed } from "vue"
import { reactiveOmit } from "@vueuse/core"
import { Check } from "@lucide/vue"
import { CheckboxIndicator, CheckboxRoot } from "reka-ui"
import { cn } from '@/utils/shadcn'

type CheckboxValue = boolean | "indeterminate"

const props = defineProps<CheckboxRootProps & {
  class?: HTMLAttributes["class"]
  checked?: CheckboxValue | null
  defaultChecked?: CheckboxValue
}>()
const emits = defineEmits<{
  "update:modelValue": [value: CheckboxValue]
  "update:checked": [value: CheckboxValue]
}>()

const delegatedProps = reactiveOmit(props, "class", "checked", "defaultChecked", "modelValue", "defaultValue")
const modelValue = computed(() => props.modelValue ?? props.checked)
const defaultValue = computed(() => props.defaultValue ?? props.defaultChecked)

const handleUpdate = (value: CheckboxValue) => {
  emits("update:modelValue", value)
  emits("update:checked", value)
}
</script>

<template>
  <CheckboxRoot
    v-bind="delegatedProps"
    :model-value="modelValue"
    :default-value="defaultValue"
    :class="
      cn('grid place-content-center peer h-4 w-4 shrink-0 rounded-sm border border-primary shadow focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=checked]:text-primary-foreground',
         props.class)"
    @update:model-value="handleUpdate"
  >
    <CheckboxIndicator class="grid place-content-center text-current">
      <slot>
        <Check class="h-4 w-4" />
      </slot>
    </CheckboxIndicator>
  </CheckboxRoot>
</template>

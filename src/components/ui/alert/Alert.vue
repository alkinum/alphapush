<script setup lang="ts">
import { computed, onMounted, provide, ref } from "vue"
import type { HTMLAttributes } from "vue"
import type { AlertVariants } from "."
import { cn } from '@/utils/shadcn'
import { alertVariants } from "."

const props = defineProps<{
  class?: HTMLAttributes["class"]
  variant?: AlertVariants["variant"]
  closable?: boolean
  allowDismissForever?: boolean
  id?: string
}>()

const emit = defineEmits<{
  'dismiss-forever': []
}>()

const isVisible = ref(true)
const showDismissForever = ref(false)

function closeAlert() {
  if (props.allowDismissForever) {
    showDismissForever.value = true
  }
  else {
    isVisible.value = false
  }
}

function dismissForever() {
  if (props.allowDismissForever && props.id) {
    isVisible.value = false
    localStorage.setItem(`alert_${props.id}_dismissed`, "true")
    emit('dismiss-forever')
  }
}

function dismissTemporarily() {
  isVisible.value = false
}

const closable = computed(() => props.closable)
const allowDismissForever = computed(() => props.allowDismissForever)

provide("closable", closable)
provide("closeAlert", closeAlert)
provide("showDismissForever", showDismissForever)
provide("dismissForever", dismissForever)
provide("dismissTemporarily", dismissTemporarily)
provide("allowDismissForever", allowDismissForever)

onMounted(() => {
  if (props.allowDismissForever && props.id) {
    const isDismissed = localStorage.getItem(`alert_${props.id}_dismissed`) === "true"
    if (isDismissed) {
      isVisible.value = false
    }
  }
})
</script>

<template>
  <div v-if="isVisible" :class="cn(alertVariants({ variant: props.variant }), props.class)" role="alert">
    <slot />
  </div>
</template>

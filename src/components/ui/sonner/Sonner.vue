<script lang="ts" setup>
import type { ToasterProps } from "vue-sonner"
import type { CompatToast, ToastWindow } from "./use-toast"
import { reactiveOmit } from "@vueuse/core"
import { CircleCheckIcon, InfoIcon, Loader2Icon, OctagonXIcon, TriangleAlertIcon, XIcon } from "@lucide/vue"
import { onMounted, onUnmounted } from "vue"
import { toast } from "vue-sonner"
import { Toaster as Sonner } from "vue-sonner"
import "vue-sonner/style.css"
import { renderToast, TOAST_DISMISS_EVENT, TOAST_EVENT } from "./use-toast"

const props = defineProps<ToasterProps>()
const delegatedProps = reactiveOmit(props, "toastOptions")

function handleToast(event: Event) {
  const props = (event as CustomEvent<CompatToast>).detail
  const targetWindow = window as ToastWindow

  targetWindow.__alphapushToastQueue = (targetWindow.__alphapushToastQueue || []).filter((toast) => toast.id !== props.id)
  renderToast({ ...props })
}

function handleDismiss(event: Event) {
  toast.dismiss((event as CustomEvent<string | number | undefined>).detail)
}

onMounted(() => {
  window.addEventListener(TOAST_EVENT, handleToast)
  window.addEventListener(TOAST_DISMISS_EVENT, handleDismiss)

  const targetWindow = window as ToastWindow
  const queuedToasts = targetWindow.__alphapushToastQueue || []

  targetWindow.__alphapushToastQueue = []
  queuedToasts.forEach((queuedToast) => renderToast({ ...queuedToast }))
})

onUnmounted(() => {
  window.removeEventListener(TOAST_EVENT, handleToast)
  window.removeEventListener(TOAST_DISMISS_EVENT, handleDismiss)
})
</script>

<template>
  <Sonner
    class="toaster group"
    :toast-options="{
      classes: {
        toast: 'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
        description: 'group-[.toast]:text-muted-foreground',
        actionButton:
          'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
        cancelButton:
          'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
      },
    }"
    v-bind="delegatedProps"
    :theme="props.theme ?? 'dark'"
  >
    <template #success-icon>
      <CircleCheckIcon class="size-4" />
    </template>
    <template #info-icon>
      <InfoIcon class="size-4" />
    </template>
    <template #warning-icon>
      <TriangleAlertIcon class="size-4" />
    </template>
    <template #error-icon>
      <OctagonXIcon class="size-4" />
    </template>
    <template #loading-icon>
      <div>
        <Loader2Icon class="size-4 animate-spin" />
      </div>
    </template>
    <template #close-icon>
      <XIcon class="size-4" />
    </template>
  </Sonner>
</template>

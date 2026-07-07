import type { Component } from 'vue'
import type { ExternalToast } from 'vue-sonner'
import { toast as sonnerToast, useVueSonner } from 'vue-sonner'

type ToastVariant = 'default' | 'destructive' | 'warning'
export const TOAST_EVENT = 'alphapush:toast'
export const TOAST_DISMISS_EVENT = 'alphapush:toast-dismiss'

let toastId = 0

export type ToastWindow = Window & {
  __alphapushToastQueue?: CompatToast[]
}

export type StringOrComponent =
  | string
  | Component
  | (() => string | Component)

type ToastAction = {
  label: string | Component
  onClick: (event: MouseEvent) => void
}

export type CompatToast = Omit<ExternalToast, 'action' | 'description'> & {
  title?: StringOrComponent
  description?: StringOrComponent
  variant?: ToastVariant
  action?: ToastAction | Component
}

export function toSonnerOptions(props: CompatToast): ExternalToast {
  const { title: _title, variant: _variant, ...options } = props

  return options
}

export function renderToast(props: CompatToast) {
  const title = props.title || ''
  const options = toSonnerOptions(props)

  return props.variant === 'destructive'
    ? sonnerToast.error(title, options)
    : props.variant === 'warning'
      ? sonnerToast.warning(title, options)
      : sonnerToast(title, options)
}

function nextToastId() {
  toastId += 1
  return `alphapush-toast-${Date.now()}-${toastId}`
}

function showToast(props: CompatToast) {
  const id = props.id ?? nextToastId()
  const toastProps = { ...props, id }

  if (typeof window !== 'undefined') {
    const targetWindow = window as ToastWindow
    targetWindow.__alphapushToastQueue = [...(targetWindow.__alphapushToastQueue || []), toastProps]
    queueMicrotask(() => {
      window.dispatchEvent(new CustomEvent<CompatToast>(TOAST_EVENT, { detail: toastProps }))
    })
  } else {
    renderToast(toastProps)
  }

  return {
    id,
    dismiss: () => dismissToast(id),
    update: (nextProps: CompatToast) => {
      showToast({ ...nextProps, id })
    },
  }
}

function dismissToast(toastId?: string | number) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<string | number | undefined>(TOAST_DISMISS_EVENT, { detail: toastId }))
    return toastId
  }

  return sonnerToast.dismiss(toastId)
}

function useToast() {
  const { activeToasts } = useVueSonner()

  return {
    toasts: activeToasts,
    toast: showToast,
    dismiss: dismissToast,
  }
}

export { showToast as toast, useToast }

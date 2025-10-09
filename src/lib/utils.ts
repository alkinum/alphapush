import type { Updater } from '@tanstack/vue-table'
import type { Ref } from 'vue'
import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function valueUpdater<T extends Updater<any>>(updaterOrValue: T, ref: Ref) {
  ref.value
    = typeof updaterOrValue === 'function'
      ? updaterOrValue(ref.value)
      : updaterOrValue
}

/**
 * Detect if the browser is Safari
 */
export function isSafari(): boolean {
  if (typeof navigator === 'undefined') return false;

  const ua = navigator.userAgent;
  const vendor = navigator.vendor;

  // Safari has "Safari" in userAgent and "Apple Computer, Inc." as vendor
  // Also check it's not Chrome (which also contains "Safari" in UA)
  return (
    /Safari/i.test(ua) &&
    /Apple Computer/.test(vendor) &&
    !/Chrome|CriOS|Edg/i.test(ua)
  );
}

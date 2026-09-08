<template>
  <div class="flex w-full flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
    <div class="min-w-0">
      <p class="text-[15px] font-semibold tracking-tight text-foreground">Welcome to AlphaPush</p>
      <p class="mt-1 text-xs leading-5 text-muted-foreground">Sign in to open your notification inbox.</p>
    </div>
    <Button type="submit" class="h-10 w-full rounded-lg border border-white/10 bg-gradient-to-b from-white/95 to-primary px-4 shadow-sm shadow-black/15 sm:w-auto sm:shrink-0" @click="handleSubmit">
      <svg viewBox="0 0 24 24" fill="currentColor" class="h-4 w-4" aria-hidden="true"><path d="M12 .5a12 12 0 0 0-3.793 23.385c.6.111.82-.261.82-.577v-2.234c-3.338.726-4.043-1.416-4.043-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.09-.745.083-.729.083-.729 1.205.085 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.108-.775.419-1.305.762-1.604-2.665-.303-5.467-1.334-5.467-5.931 0-1.31.469-2.381 1.236-3.221-.124-.303-.536-1.524.117-3.176 0 0 1.008-.322 3.301 1.23a11.52 11.52 0 0 1 6.006 0c2.291-1.552 3.297-1.23 3.297-1.23.655 1.652.243 2.873.119 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.625-5.479 5.922.431.372.815 1.103.815 2.222v3.293c0 .319.216.694.825.576A12.001 12.001 0 0 0 12 .5Z" /></svg>
      Login with GitHub
    </Button>
  </div>
</template>

<script lang="ts" setup>
import { Button } from '@/components/ui/button';

const handleSubmit = () => {
  const loginEvent = new CustomEvent('login', {
    detail: { provider: 'github' },
    bubbles: true,
    composed: true,
  });

  document.dispatchEvent(loginEvent);
};
</script>

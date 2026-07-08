<template>
  <div class="flex w-full flex-col gap-4 p-6 sm:flex-row sm:items-center sm:justify-between">
    <p class="text-sm font-medium text-foreground sm:text-base">Login to initialize your AlphaPush</p>
    <Button type="submit" class="w-full sm:w-auto sm:shrink-0" @click="handleSubmit">
      <Icon icon="mdi:github" class="mr-2 h-5 w-5" />
      Login with GitHub
    </Button>
  </div>
</template>

<script lang="ts" setup>
import { Button } from '@/components/ui/button';
import { Icon } from '@iconify/vue';

const handleSubmit = () => {
  const loginEvent = new CustomEvent('login', {
    detail: { provider: 'github' },
    bubbles: true,
    composed: true,
  });

  document.dispatchEvent(loginEvent);
};
</script>

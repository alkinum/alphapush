<template>
  <div class="flex flex-col items-center space-y-4 p-6 rounded-lg shadow-md">
    <p>Login to initialize your AlphaPush</p>
    <Button type="submit" class="w-full" @click="handleSubmit">
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

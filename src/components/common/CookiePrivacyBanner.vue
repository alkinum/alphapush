<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Button } from '@/components/ui/button';

const isVisible = ref(false);

onMounted(() => {
  const hasAcceptedCookies = localStorage.getItem('cookiesAccepted');
  if (!hasAcceptedCookies) {
    setTimeout(() => {
      isVisible.value = true;
    }, 500);
  }
});

const acceptCookies = () => {
  localStorage.setItem('cookiesAccepted', 'true');
  isVisible.value = false;
};
</script>

<template>
  <Transition name="slide-up">
    <div v-if="isVisible" class="fixed bottom-0 left-0 right-0 bg-background border-t border-border p-4 shadow-lg z-50">
      <div class="container mx-auto flex flex-col sm:flex-row items-center justify-between">
        <p class="text-sm text-muted-foreground mb-4 sm:mb-0 sm:mr-4">
          We use cookies and device information to improve your experience. By continuing to use our site, you agree to
          our
          <a href="/privacy-policy" class="text-primary hover:underline">Privacy Policy</a>.
        </p>
        <Button @click="acceptCookies" variant="outline" size="sm"> Accept </Button>
      </div>
    </div>
  </Transition>
</template>

<style scoped>
.slide-up-enter-active,
.slide-up-leave-active {
  transition: transform 0.3s ease-out;
}
.slide-up-enter-from,
.slide-up-leave-to {
  transform: translateY(100%);
}
</style>

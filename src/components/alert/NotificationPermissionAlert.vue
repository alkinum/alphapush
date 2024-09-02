<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast/use-toast';

const showAlert = ref(false);
const isIOS = ref(false);
const { toast } = useToast();

onMounted(() => {
  isIOS.value = /iPad|iPhone|iPod/.test(navigator.userAgent);
  if ('Notification' in window) {
    showAlert.value = Notification.permission === 'default';
  }
});

const requestPermission = async () => {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      showAlert.value = false;
      window.dispatchEvent(new Event('notificationPermissionGranted'));
    } else if (permission === 'denied') {
      if (isIOS.value) {
        toast({
          title: 'Notification Permission Denied',
          description: 'To make the app work, please re-add it to your home screen.',
          variant: 'destructive',
        });
      } else {
        toast({
          title: 'Notification Permission Denied',
          description: 'Please enable notifications in your browser settings to receive push messages.',
          variant: 'destructive',
        });
      }
    }
  }
};
</script>

<template>
  <Alert v-if="showAlert" class="mb-4" variant="warning">
    <AlertTitle>Notification Permission Required</AlertTitle>
    <AlertDescription class="mb-2">
      {{
        isIOS
          ? 'To ensure the app works properly, we need your notification permission.'
          : 'We need your notification permission to send important updates.'
      }}
    </AlertDescription>
    <Button class="font-bold w-full" @click="requestPermission" variant="outline" size="sm">
      Request Permission
    </Button>
  </Alert>
</template>

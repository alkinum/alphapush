<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { Icon } from '@iconify/vue';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast/use-toast';
import { hasActiveWebPushSubscription, repairPushSubscription } from '@/modules/pushSubscription';

type AlertMode = 'permission' | 'repair' | null;

interface SubscriptionHealthResponse {
  total: number;
  needsRepair: boolean;
  failingCount: number;
  staleCount: number;
}

const alertMode = ref<AlertMode>(null);
const isIOS = ref(false);
const isCheckingHealth = ref(false);
const isRepairing = ref(false);
const repairDescription = ref('Notifications need to be repaired on this device.');
const { toast } = useToast();

onMounted(() => {
  isIOS.value = /iPad|iPhone|iPod/.test(navigator.userAgent);
  void evaluateNotificationState();
  document.addEventListener('subscriptionSuccess', handleSubscriptionSuccess);
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('online', handleOnline);
});

onUnmounted(() => {
  document.removeEventListener('subscriptionSuccess', handleSubscriptionSuccess);
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('online', handleOnline);
});

const requestPermission = async () => {
  if ('Notification' in window) {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      alertMode.value = null;
      document.dispatchEvent(new Event('notificationPermissionGranted'));
      window.dispatchEvent(new Event('notificationPermissionGranted'));
      setTimeout(() => {
        void evaluateNotificationState();
      }, 1000);
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

const repairNotifications = async () => {
  try {
    isRepairing.value = true;
    const success = await repairPushSubscription();

    if (!success) {
      throw new Error('Repair failed');
    }

    toast({
      title: 'Notifications Repaired',
      description: 'This device has been resubscribed to Web Push.',
    });

    alertMode.value = null;
    await evaluateNotificationState();
  } catch (error) {
    console.error('Failed to repair notification subscription:', error);
    toast({
      title: 'Repair Failed',
      description: 'Please reload the app and try again.',
      variant: 'destructive',
    });
  } finally {
    isRepairing.value = false;
  }
};

async function evaluateNotificationState() {
  if (!('Notification' in window)) {
    alertMode.value = null;
    return;
  }

  if (Notification.permission === 'default') {
    alertMode.value = 'permission';
    return;
  }

  if (Notification.permission !== 'granted' || !supportsWebPush()) {
    alertMode.value = null;
    return;
  }

  try {
    isCheckingHealth.value = true;
    const [hasLocalSubscription, serverHealth] = await Promise.all([
      hasActiveWebPushSubscription(),
      getSubscriptionHealth(),
    ]);

    if (!hasLocalSubscription) {
      repairDescription.value = 'Notifications are allowed, but this browser has no active subscription.';
      alertMode.value = 'repair';
      return;
    }

    if (serverHealth?.needsRepair) {
      repairDescription.value =
        serverHealth.total === 0
          ? 'This device is not registered on the server.'
          : 'Recent push delivery attempts indicate this subscription may be stale.';
      alertMode.value = 'repair';
      return;
    }

    alertMode.value = null;
  } catch (error) {
    console.debug('Skipping subscription health alert:', error);
  } finally {
    isCheckingHealth.value = false;
  }
}

async function getSubscriptionHealth(): Promise<SubscriptionHealthResponse | null> {
  const response = await fetch('/api/subscription', {
    method: 'GET',
    credentials: 'include',
  });

  if (!response.ok) {
    return null;
  }

  return (await response.json()) as SubscriptionHealthResponse;
}

function supportsWebPush(): boolean {
  return ('serviceWorker' in navigator && 'PushManager' in window) || 'pushManager' in window;
}

function handleSubscriptionSuccess() {
  void evaluateNotificationState();
}

function handleVisibilityChange() {
  if (document.visibilityState === 'visible') {
    void evaluateNotificationState();
  }
}

function handleOnline() {
  void evaluateNotificationState();
}
</script>

<template>
  <Alert v-if="alertMode === 'permission'" class="mb-4" variant="warning">
    <AlertTitle>Notification Permission Required</AlertTitle>
    <AlertDescription class="mb-2">
      {{
        isIOS
          ? 'To ensure the app works properly, we need your notification permission.'
          : 'We need your notification permission to send important updates.'
      }}
    </AlertDescription>
    <Button class="font-bold w-full" @click="requestPermission" variant="outline" size="sm">
      <Icon icon="mdi:bell-ring" class="h-4 w-4 mr-2" />
      Request Permission
    </Button>
  </Alert>
  <Alert v-else-if="alertMode === 'repair'" class="mb-4" variant="warning">
    <AlertTitle>Notification Subscription Needs Repair</AlertTitle>
    <AlertDescription class="mb-2">
      {{ repairDescription }}
    </AlertDescription>
    <Button
      class="font-bold w-full"
      @click="repairNotifications"
      variant="outline"
      size="sm"
      :disabled="isCheckingHealth || isRepairing"
    >
      <Icon
        :icon="isRepairing ? 'mdi:loading' : 'mdi:refresh'"
        class="h-4 w-4 mr-2"
        :class="{ 'animate-spin': isRepairing }"
      />
      {{ isRepairing ? 'Repairing...' : 'Repair Notifications' }}
    </Button>
  </Alert>
</template>

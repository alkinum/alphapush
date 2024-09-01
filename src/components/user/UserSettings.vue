<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { useToast } from '@/components/ui/toast/use-toast';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Icon } from '@iconify/vue';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';

const { toast } = useToast();

const isOpen = ref(false);
const showResetVapidDialog = ref(false);
const showResetPushTokenDialog = ref(false);
const pushToken = ref<string | undefined>(undefined);
const vapidPublicKey = ref<string | null>(null);

const props = defineProps<{
  initialPushToken?: string;
  userInfo: {
    email: string;
    nickname?: string;
  };
}>();

const displayName = computed(() => {
  if (props.userInfo.nickname) {
    return props.userInfo.nickname;
  }
  const email = props.userInfo.email;
  if (email.length > 20) {
    const [prefix, suffix] = email.split('@');
    return `${prefix.slice(0, 3)}...${prefix.slice(-3)}@${suffix}`;
  }
  return email;
});

const userInitials = computed(() => {
  const name = props.userInfo.nickname || props.userInfo.email.split('@')[0];
  return name.slice(0, 2).toUpperCase();
});

onMounted(() => {
  pushToken.value = props.initialPushToken;
  vapidPublicKey.value = localStorage.getItem('vapidPublicKey');
});

const copyPushToken = () => {
  if (!pushToken.value) {
    toast({
      title: 'Error',
      description: 'No push token available to copy',
      variant: 'destructive',
    });
    return;
  }

  navigator.clipboard.writeText(pushToken.value).then(
    () => {
      toast({
        title: 'Copied',
        description: 'Push token copied to clipboard',
      });
    },
    (err) => {
      console.error('Error copying push token:', err);
      toast({
        title: 'Error',
        description: 'Failed to copy push token',
        variant: 'destructive',
      });
    },
  );
};

const resetVapidKeys = async () => {
  try {
    const response = await fetch('/api/vapid-keys', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reset' }),
    });
    if (response.ok) {
      const data: { publicKey: string } = await response.json();
      const newPublicKey = data.publicKey;

      // Update local storage
      localStorage.setItem('vapidPublicKey', newPublicKey);

      // Emit an event to trigger resubscription
      document.dispatchEvent(new CustomEvent('vapidKeysReset', { detail: { newPublicKey } }));

      toast({
        title: 'Success',
        description: 'VAPID keys have been reset. Resubscribing to notifications...',
      });
    } else {
      throw new Error('Reset failed');
    }
  } catch (error) {
    console.error('Error resetting VAPID keys:', error);
    toast({
      title: 'Error',
      description: 'Failed to reset VAPID keys. Please try again later.',
      variant: 'destructive',
    });
  }
  showResetVapidDialog.value = false;
};

const resetPushToken = async () => {
  try {
    const response = await fetch('/api/push-token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reset' }),
    });
    if (response.ok) {
      const result: { pushToken: string } = await response.json();
      pushToken.value = result.pushToken;
      toast({
        title: 'Success',
        description: 'Push token has been reset.',
      });
      // Dispatch an event to update the push token in other components
      document.dispatchEvent(new CustomEvent('newPushToken', { detail: { pushToken: result.pushToken } }));
    } else {
      throw new Error('Reset failed');
    }
  } catch (error) {
    toast({
      title: 'Error',
      description: 'Failed to reset push token. Please try again later.',
      variant: 'destructive',
    });
  }
  showResetPushTokenDialog.value = false;
};

const openSettings = () => {
  isOpen.value = true;
};

defineExpose({ openSettings });
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent>
      <SheetHeader>
        <SheetTitle>User Settings</SheetTitle>
        <SheetDescription> Manage your account and push notification settings. </SheetDescription>
      </SheetHeader>
      <div class="grid gap-4 py-4">
        <Card>
          <CardHeader>
            <CardTitle>User Information</CardTitle>
          </CardHeader>
          <CardContent :class="cn('pt-0')">
            <div class="flex items-center space-x-4">
              <Avatar>
                <AvatarFallback>{{ userInitials }}</AvatarFallback>
              </Avatar>
              <div>
                <p class="text-sm font-medium">{{ displayName }}</p>
                <p class="text-xs text-muted-foreground">{{ props.userInfo.email }}</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Push Token</CardTitle>
          </CardHeader>
          <CardContent :class="cn('pt-0')">
            <div class="flex items-center space-x-2">
              <div class="flex-grow p-2 bg-secondary rounded-md">
                <p v-if="pushToken" class="text-xs font-mono break-all">{{ pushToken }}</p>
                <p v-else class="text-xs text-muted-foreground italic">No push token available</p>
              </div>
              <Button @click="copyPushToken" variant="outline" size="icon" :disabled="!pushToken">
                <Icon icon="mdi:content-copy" class="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Danger Zone</CardTitle>
          </CardHeader>
          <CardContent :class="cn('pt-0 space-y-4')">
            <div>
              <h4 class="text-sm font-medium mb-2">Reset VAPID Keys</h4>
              <div class="flex items-center justify-between">
                <p class="text-xs text-muted-foreground flex-grow pr-4">
                  Reset VAPID keys for push notifications. All existing subscriptions will be invalidated.
                </p>
                <Button
                  @click="showResetVapidDialog = true"
                  variant="destructive"
                  size="sm"
                  :disabled="!vapidPublicKey"
                >
                  Reset
                </Button>
              </div>
            </div>
            <Separator />
            <div>
              <h4 class="text-sm font-medium mb-2">Reset Push Token</h4>
              <div class="flex items-center justify-between">
                <p class="text-xs text-muted-foreground flex-grow pr-4">
                  Reset your push token. You'll need to resubscribe to push notifications.
                </p>
                <Button @click="showResetPushTokenDialog = true" variant="destructive" size="sm" :disabled="!pushToken">
                  Reset
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </SheetContent>
  </Sheet>

  <Dialog v-model:open="showResetVapidDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle class="mb-4">Warning: Reset VAPID Keys</DialogTitle>
        <DialogDescription>
          <p>Resetting VAPID keys will have the following consequences:</p>
          <ul class="list-disc pl-5 mt-2">
            <li>All existing push subscriptions on other devices will immediately stop working</li>
            <li>Other devices need to re-enter the app to automatically refresh the VAPID keys</li>
            <li>Users may temporarily be unable to receive push notifications until resubscribing</li>
          </ul>
          <p class="mt-2">Are you sure you want to proceed?</p>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button @click="showResetVapidDialog = false" variant="outline">Cancel</Button>
        <Button @click="resetVapidKeys" variant="destructive">Confirm Reset</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>

  <Dialog v-model:open="showResetPushTokenDialog">
    <DialogContent>
      <DialogHeader>
        <DialogTitle class="mb-4">Warning: Reset Push Token</DialogTitle>
        <DialogDescription>
          <p>Resetting the push token will have the following consequences:</p>
          <ul class="list-disc pl-5 mt-2">
            <li>All existing push subscriptions on this device will immediately become invalid</li>
            <li>You will not receive any push notifications until you resubscribe</li>
            <li>You need to resubscribe to push notifications to restore functionality</li>
          </ul>
          <p class="mt-2">Are you sure you want to proceed?</p>
        </DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <Button @click="showResetPushTokenDialog = false" variant="outline">Cancel</Button>
        <Button @click="resetPushToken" variant="destructive">Confirm Reset</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

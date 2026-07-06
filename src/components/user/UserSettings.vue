<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { Icon } from '@iconify/vue';

import type { UserRole } from '@/auth';
import { useToast } from '@/components/ui/toast/use-toast';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Separator } from '@/components/ui/separator';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { cn } from '@/utils/shadcn';
import { setMasterKey, getMasterKey } from '@/utils/encryption';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { defaultPreferences, userPreferenceManager, type UserPreference } from '@/services/userPreferenceService';
import { getCombinedFingerprint } from '@/utils/fingerprint';
import { getPushDeliveryWarning, hasConfirmedPushDelivery, type PushApiResponse } from '@/utils/pushResponse';

const { toast } = useToast();

const isOpen = ref(false);
const showResetVapidDialog = ref(false);
const showResetPushTokenDialog = ref(false);
const pushToken = ref<string | undefined>(undefined);
const vapidPublicKey = ref<string | null>(null);
const showNotificationIcons = ref(true);
const barkFallbackEnabled = ref(false);
const barkFallbackAlways = ref(false);
const barkServerUrl = ref(defaultPreferences.barkServerUrl);
const barkDeviceKey = ref('');
const showBarkDeviceKey = ref(false);
const isSendingTestPush = ref(false);
const isSavingBarkFallback = ref(false);
const currentDeviceFingerprint = ref<string | null>(null);

const props = defineProps<{
  initialPushToken?: string;
  userInfo: {
    email: string;
    nickname?: string;
    role?: UserRole;
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

const masterKey = ref('');
const showMasterKey = ref(false);

const applyUserPreferences = (preferences: UserPreference) => {
  showNotificationIcons.value = preferences.showNotificationIcons ?? defaultPreferences.showNotificationIcons;
};

const applyBarkFallbackPreferences = (
  preferences: Pick<UserPreference, 'barkFallbackEnabled' | 'barkFallbackAlways' | 'barkServerUrl' | 'barkDeviceKey'>
) => {
  barkFallbackEnabled.value = preferences.barkFallbackEnabled ?? defaultPreferences.barkFallbackEnabled;
  barkFallbackAlways.value = preferences.barkFallbackAlways ?? defaultPreferences.barkFallbackAlways;
  barkServerUrl.value = preferences.barkServerUrl || defaultPreferences.barkServerUrl;
  barkDeviceKey.value = preferences.barkDeviceKey || '';
};

const applyLocalPreferences = (preferences: UserPreference) => {
  applyUserPreferences(preferences);
  applyBarkFallbackPreferences(preferences);
};

onMounted(async () => {
  // Only run client-side code in the browser
  if (typeof window !== 'undefined') {
    pushToken.value = props.initialPushToken;
    vapidPublicKey.value = localStorage.getItem('vapidPublicKey');
    const existingMasterKey = await getMasterKey();
    if (existingMasterKey) {
      masterKey.value = existingMasterKey;
    }

    // First load from local storage for immediate UI state.
    applyLocalPreferences(userPreferenceManager.getLocalPreferences() || { ...defaultPreferences });

    // Then fetch the latest preferences from server to ensure we're in sync
    if (props.userInfo.email) {
      try {
        const response = await fetch('/api/user-preferences', {
          method: 'GET',
          credentials: 'include',
        });

        if (response.ok) {
          const data = (await response.json()) as { preferences: UserPreference };
          const preferences = data.preferences;

          if (preferences) {
            // Update local state with server values
            applyUserPreferences(preferences);

            // Keep Bark fallback local/device-scoped; do not import an account-level device key.
            userPreferenceManager.saveLocalPreferences({
              ...(userPreferenceManager.getLocalPreferences() || { ...defaultPreferences }),
              showNotificationIcons: preferences.showNotificationIcons,
            });

            console.debug('Loaded user preferences from server');
          }
        }
      } catch (error) {
        console.error('Error fetching user preferences:', error);
        // Continue with local preferences if server fetch fails
      }

      try {
        currentDeviceFingerprint.value = await getCombinedFingerprint(props.userInfo.email);
        const response = await fetch(
          `/api/subscription/fallback?deviceFingerprint=${encodeURIComponent(currentDeviceFingerprint.value)}`,
          {
            method: 'GET',
            credentials: 'include',
          }
        );

        if (response.ok) {
          const data = (await response.json()) as {
            barkFallbackEnabled: boolean;
            barkFallbackAlways: boolean;
            barkServerUrl: string;
            barkDeviceKey: string;
          };

          applyBarkFallbackPreferences(data);
        }
      } catch (error) {
        console.debug('Current device Bark fallback config is not available:', error);
      }
    }
  }
});

const toggleNotificationIcons = async (value: boolean) => {
  // value is already set to showNotificationIcons.value via v-model
  // so we don't need to set it again

  // Always sync with remote server
  try {
    // Save to local storage first for immediate UI response
    userPreferenceManager.saveLocalPreferences({
      ...(userPreferenceManager.getLocalPreferences() || { ...defaultPreferences }),
      showNotificationIcons: value,
    });

    // Then send a direct API request to update the server
    const response = await fetch('/api/user-preferences', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        key: 'showNotificationIcons',
        value: value,
      }),
    });

    if (!response.ok) {
      throw new Error('Failed to update preference on server');
    }

    toast({
      title: value ? 'Icons Enabled' : 'Icons Disabled',
      description: value ? 'Notification icons will now be displayed.' : 'Notification icons will be hidden.',
    });
  } catch (error) {
    console.error('Error syncing notification icon preference:', error);
    toast({
      title: 'Error',
      description: 'Failed to save preference. Please try again.',
      variant: 'destructive',
    });
  }
};

const saveBarkFallbackPreferences = async () => {
  const trimmedServerUrl = barkServerUrl.value.trim() || defaultPreferences.barkServerUrl;
  const trimmedDeviceKey = barkDeviceKey.value.trim();

  if (barkFallbackEnabled.value && !trimmedDeviceKey) {
    toast({
      title: 'Missing Device Key',
      description: 'Enter a Bark device key before enabling fallback.',
      variant: 'destructive',
    });
    return;
  }

  try {
    const parsedUrl = new URL(trimmedServerUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      throw new Error('Bark server URL must use http or https');
    }
  } catch (error) {
    toast({
      title: 'Invalid Bark Server',
      description: error instanceof Error ? error.message : 'Enter a valid Bark server URL.',
      variant: 'destructive',
    });
    return;
  }

  const preferences = {
    barkFallbackEnabled: barkFallbackEnabled.value,
    barkFallbackAlways: barkFallbackEnabled.value ? barkFallbackAlways.value : false,
    barkServerUrl: trimmedServerUrl,
    barkDeviceKey: trimmedDeviceKey,
  };

  try {
    isSavingBarkFallback.value = true;
    if (!currentDeviceFingerprint.value) {
      currentDeviceFingerprint.value = await getCombinedFingerprint(props.userInfo.email);
    }

    const deviceResponse = await fetch('/api/subscription/fallback', {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      credentials: 'include',
      body: JSON.stringify({
        deviceFingerprint: currentDeviceFingerprint.value,
        enabled: preferences.barkFallbackEnabled,
        always: preferences.barkFallbackAlways,
        serverUrl: preferences.barkServerUrl,
        deviceKey: preferences.barkDeviceKey,
      }),
    });

    if (!deviceResponse.ok) {
      const errorData = (await deviceResponse.json().catch(() => ({}))) as { error?: string };
      if (deviceResponse.status === 404) {
        throw new Error('Subscribe this device to Web Push before saving Bark fallback settings.');
      }

      throw new Error(
        errorData.error || 'Failed to save current device fallback settings'
      );
    }

    const data = (await deviceResponse.json()) as Pick<
      UserPreference,
      'barkFallbackEnabled' | 'barkFallbackAlways' | 'barkServerUrl' | 'barkDeviceKey'
    >;
    applyBarkFallbackPreferences(data);
    userPreferenceManager.saveLocalPreferences({
      ...(userPreferenceManager.getLocalPreferences() || { ...defaultPreferences }),
      ...data,
    });

    toast({
      title: 'Bark Fallback Saved',
      description: barkFallbackEnabled.value
        ? 'Bark fallback is ready for this device.'
        : 'Bark fallback is disabled for this device.',
    });
  } catch (error) {
    console.error('Error saving Bark fallback settings:', error);
    toast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to save Bark fallback settings.',
      variant: 'destructive',
    });
  } finally {
    isSavingBarkFallback.value = false;
  }
};

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

const sendTestPush = async () => {
  if (!pushToken.value) {
    toast({
      title: 'Error',
      description: 'No push token available to send test notification',
      variant: 'destructive',
    });
    return;
  }

  try {
    isSendingTestPush.value = true;

    const response = await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pushToken: pushToken.value,
        content: 'This is a test notification from AlphaPush.',
        title: 'Test Notification',
        subtitle: 'Sent from your device',
        category: 'test',
        test: true,
      }),
    });

    const result = (await response.json().catch(() => ({}))) as PushApiResponse;
    const deliveryWarning = getPushDeliveryWarning(result);

    if (hasConfirmedPushDelivery(result)) {
      toast({
        title: deliveryWarning ? 'Test notification sent' : 'Success',
        description: deliveryWarning || 'Test notification sent successfully',
        variant: deliveryWarning ? 'warning' : undefined,
      });
    } else if (!response.ok) {
      throw new Error(result.error || 'Failed to send test notification');
    } else {
      throw new Error(result.error || 'Failed to send test notification');
    }
  } catch (error) {
    console.error('Error sending test notification:', error);
    toast({
      title: 'Error',
      description: error instanceof Error ? error.message : 'Failed to send test notification',
      variant: 'destructive',
    });
  } finally {
    isSendingTestPush.value = false;
  }
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

      try {
        await Promise.race([
          new Promise((resolve) => {
            const subscriptionSuccessHandler = () => {
              document.removeEventListener('subscriptionSuccess', subscriptionSuccessHandler);
              resolve(null);
            };
            document.addEventListener('subscriptionSuccess', subscriptionSuccessHandler);
          }),
          new Promise((_, reject) => setTimeout(() => reject(new Error('Subscription timeout')), 10000)),
        ]);

        toast({
          title: 'Subscription Successful',
          description: 'You have successfully resubscribed to notifications with new VAPID keys.',
        });
      } catch (subscriptionError: unknown) {
        if (subscriptionError instanceof Error && subscriptionError.message === 'Subscription timeout') {
          console.warn('Subscription process timed out');
          toast({
            title: 'Warning',
            description: 'Resubscription process is taking longer than expected. It may complete in the background.',
            variant: 'warning',
          });
        } else {
          throw subscriptionError;
        }
      }
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

const saveMasterKey = async () => {
  try {
    await setMasterKey(masterKey.value || null);
    toast({
      title: 'Success',
      description: masterKey.value ? 'Encryption key has been set.' : 'Encryption key has been removed.',
    });
  } catch (error) {
    console.error('Error setting encryption key:', error);
    toast({
      title: 'Error',
      description: 'Failed to set encryption key. Please try again.',
      variant: 'destructive',
    });
  }
};

const openSettings = () => {
  isOpen.value = true;
};

defineExpose({ openSettings });
</script>

<template>
  <Sheet v-model:open="isOpen">
    <SheetContent class="flex flex-col">
      <SheetHeader>
        <SheetTitle>User Settings</SheetTitle>
        <SheetDescription>Manage your account, push notification settings, and security.</SheetDescription>
      </SheetHeader>
      <div class="scrollable-content flex-1">
        <div class="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle>User Information</CardTitle>
            </CardHeader>
            <CardContent :class="cn('pt-0')">
              <div class="flex items-center justify-between">
                <div class="flex items-center space-x-4">
                  <Avatar>
                    <AvatarFallback>{{ userInitials }}</AvatarFallback>
                  </Avatar>
                  <div>
                    <p class="text-sm font-medium">{{ displayName }}</p>
                    <p class="text-xs text-muted-foreground">{{ props.userInfo.email }}</p>
                  </div>
                </div>
                <Badge v-if="props.userInfo.role === 'admin'" variant="secondary" class="text-xs py-1 select-none">
                  Admin
                </Badge>
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
              <div class="mt-3 flex w-full">
                <Button
                  @click="sendTestPush"
                  variant="secondary"
                  size="sm"
                  :disabled="!pushToken || isSendingTestPush"
                  class="w-full"
                >
                  <Icon
                    :icon="isSendingTestPush ? 'mdi:loading' : 'mdi:send'"
                    class="h-4 w-4 mr-2"
                    :class="{ 'animate-spin': isSendingTestPush }"
                  />
                  Send Test Notification
                </Button>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>End-to-End Encryption Key</CardTitle>
            </CardHeader>
            <CardContent :class="cn('pt-0 space-y-4')">
              <div class="space-y-2">
                <Label for="masterKey">Encryption Key</Label>
                <div class="flex space-x-2">
                  <Input
                    id="masterKey"
                    v-model="masterKey"
                    :type="showMasterKey ? 'text' : 'password'"
                    placeholder="Enter encryption key"
                  />
                  <Button @click="showMasterKey = !showMasterKey" variant="outline" size="icon">
                    <Icon :icon="showMasterKey ? 'mdi:eye' : 'mdi:eye-off'" class="h-4 w-4" />
                  </Button>
                  <Button @click="saveMasterKey" variant="outline" size="icon">
                    <Icon icon="mdi:content-save" class="h-4 w-4" />
                  </Button>
                </div>
                <div class="space-y-1">
                  <p class="text-sm text-muted-foreground">
                    This key is used for end-to-end encryption in the push service. Make sure it matches the key used by
                    your push source.
                  </p>
                  <p class="text-sm font-medium text-yellow-600 dark:text-yellow-400">
                    Warning: If the key is incorrect, all encrypted notifications will fail to decrypt.
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>UI Preferences</CardTitle>
            </CardHeader>
            <CardContent :class="cn('pt-0 space-y-4')">
              <div class="flex items-center justify-between">
                <div class="space-y-0.5">
                  <Label for="notification-icons">Show Notification Icons</Label>
                  <p class="text-xs text-muted-foreground">Display icons in notifications when available</p>
                </div>
                <Switch
                  id="notification-icons"
                  :model-value="showNotificationIcons"
                  @update:model-value="toggleNotificationIcons"
                />
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle>Delivery Reliability</CardTitle>
            </CardHeader>
            <CardContent :class="cn('pt-0 space-y-4')">
              <div class="flex items-center justify-between gap-4">
                <div class="space-y-0.5">
                  <Label for="bark-fallback-enabled">Bark Fallback</Label>
                  <p class="text-xs text-muted-foreground">Forward to Bark when Web Push has no successful delivery</p>
                </div>
                <Switch
                  id="bark-fallback-enabled"
                  :model-value="barkFallbackEnabled"
                  @update:model-value="(value) => (barkFallbackEnabled = value)"
                />
              </div>

              <div class="space-y-2">
                <Label for="bark-server-url">Bark Server</Label>
                <Input
                  id="bark-server-url"
                  v-model="barkServerUrl"
                  placeholder="https://api.day.app"
                  :disabled="!barkFallbackEnabled"
                />
              </div>

              <div class="space-y-2">
                <Label for="bark-device-key">Bark Device Key</Label>
                <div class="flex space-x-2">
                  <Input
                    id="bark-device-key"
                    v-model="barkDeviceKey"
                    :type="showBarkDeviceKey ? 'text' : 'password'"
                    placeholder="Device key"
                    :disabled="!barkFallbackEnabled"
                  />
                  <Button
                    @click="showBarkDeviceKey = !showBarkDeviceKey"
                    variant="outline"
                    size="icon"
                    :disabled="!barkFallbackEnabled"
                  >
                    <Icon :icon="showBarkDeviceKey ? 'mdi:eye' : 'mdi:eye-off'" class="h-4 w-4" />
                  </Button>
                </div>
              </div>

              <div class="flex items-center justify-between gap-4">
                <div class="space-y-0.5">
                  <Label for="bark-fallback-always">Always Send to Bark</Label>
                  <p class="text-xs text-muted-foreground">Use Bark as a parallel channel for every notification</p>
                </div>
                <Switch
                  id="bark-fallback-always"
                  :model-value="barkFallbackAlways"
                  :disabled="!barkFallbackEnabled"
                  @update:model-value="(value) => (barkFallbackAlways = value)"
                />
              </div>

              <Button
                @click="saveBarkFallbackPreferences"
                variant="secondary"
                size="sm"
                class="w-full"
                :disabled="isSavingBarkFallback"
              >
                <Icon
                  :icon="isSavingBarkFallback ? 'mdi:loading' : 'mdi:content-save'"
                  class="h-4 w-4 mr-2"
                  :class="{ 'animate-spin': isSavingBarkFallback }"
                />
                Save Bark Fallback
              </Button>
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
                  <Button
                    @click="showResetPushTokenDialog = true"
                    variant="destructive"
                    size="sm"
                    :disabled="!pushToken"
                  >
                    Reset
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
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

<style scoped>
@reference "../../styles/globals.css";

.scrollable-content {
  @apply overflow-y-auto pr-6 -mr-6;
  scrollbar-width: thin;
  scrollbar-color: hsl(var(--muted)) transparent;
}

.scrollable-content::-webkit-scrollbar {
  @apply w-2;
}

.scrollable-content::-webkit-scrollbar-track {
  @apply bg-transparent;
}

.scrollable-content::-webkit-scrollbar-thumb {
  @apply bg-muted rounded-full;
}

.scrollable-content::-webkit-scrollbar-thumb:hover {
  @apply bg-muted/80;
}
</style>

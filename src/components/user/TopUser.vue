<template>
  <div class="flex items-center">
    <DropdownMenu>
      <DropdownMenuTrigger class="flex items-center space-x-2">
        <Avatar>
          <AvatarFallback>{{ userInitials }}</AvatarFallback>
        </Avatar>
        <span class="text-sm font-medium">{{ displayName }}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent>
        <DropdownMenuItem v-if="localPushToken" @click="copyPushToken">
          <div class="flex flex-col pr-2 box-border">
            <span class="text-xs text-muted-foreground">Push Token:</span>
            <span class="text-xs font-mono truncate max-w-[150px]">{{ localPushToken }}</span>
          </div>
          <DropdownMenuShortcut>
            <Icon icon="mdi:content-copy" class="h-3 w-3" />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuSeparator v-if="localPushToken" />
        <DropdownMenuItem @click="openUserSettings">
          <span class="text-xs">User Settings</span>
          <DropdownMenuShortcut>
            <Icon icon="mdi:cog" class="h-3 w-3" />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
        <DropdownMenuItem @click="handleLogout">
          <span class="text-xs">Log Out</span>
          <DropdownMenuShortcut>
            <Icon icon="mdi:logout" class="h-3 w-3" />
          </DropdownMenuShortcut>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
    <UserSettings ref="userSettingsRef" :initial-push-token="localPushToken" :user-info="props.userInfo" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Icon } from '@iconify/vue';

import type { UserRole } from '@/auth';
import { useToast } from '@/components/ui/toast';

import UserSettings from './UserSettings.vue';

interface UserInfo {
  email: string;
  nickname?: string;
  pushToken?: string;
  role?: UserRole;
}

const props = defineProps<{
  userInfo: UserInfo;
}>();

const localPushToken = ref(props.userInfo.pushToken);
const userSettingsRef = ref<InstanceType<typeof UserSettings> | null>(null);

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

const handleLogout = () => {
  document.dispatchEvent(new CustomEvent('logout'));
};

const { toast } = useToast();

const copyPushToken = () => {
  if (localPushToken.value) {
    navigator.clipboard
      .writeText(localPushToken.value)
      .then(() => {
        toast({
          title: 'Success',
          description: 'Push token copied to clipboard!',
          duration: 3000,
        });
      })
      .catch((err) => {
        console.error('Failed to copy push token: ', err);
        toast({
          title: 'Error',
          description: 'Failed to copy push token. Please try again.',
          variant: 'destructive',
          duration: 3000,
        });
      });
  }
};

const openUserSettings = () => {
  if (userSettingsRef.value) {
    userSettingsRef.value.openSettings();
  }
};

const handleNewPushToken = (event: CustomEvent<{ pushToken: string }>) => {
  localPushToken.value = event.detail.pushToken;
};

onMounted(() => {
  document.addEventListener('newPushToken', handleNewPushToken as EventListener);
});

onUnmounted(() => {
  document.removeEventListener('newPushToken', handleNewPushToken as EventListener);
});

// Watch for changes in the userInfo prop
watch(() => props.userInfo.pushToken, (newToken) => {
  if (newToken !== undefined) {
    localPushToken.value = newToken;
  }
});
</script>

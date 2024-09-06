<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

import { Icon } from '@iconify/vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Notification } from '@/types/notification';
import { getCombinedFingerprint } from '@/utils/fingerprint';

import Login from '../user/Login.vue';
import NotificationCard from './NotificationCard.vue';

interface Props {
  session: {
    user?: {
      email: string;
      name?: string;
    } | null;
  } | null;
  initialNotifications: Notification[];
  initialTotalPages: number;
}

const props = defineProps<Props>();

const user = ref(props.session?.user);

const notifications = ref<Notification[]>(props.initialNotifications);
const totalPages = ref(props.initialTotalPages);
const currentPage = ref(1);
const initialLoading = ref(false);
const isLoading = ref(false);
const isLoadFailed = ref(false);
const retryCount = ref(0);
const maxRetries = 3;

let eventSource: EventSource | null = null;

const fetchNotifications = async (page: number) => {
  if (isLoading.value || isLoadFailed.value) {
    return;
  }
  isLoading.value = true;

  try {
    const response = await fetch(`/api/notifications?page=${page}&pageSize=10`);
    const data: { notifications: Notification[]; totalPages: number } = await response.json();

    if (page === 1) {
      notifications.value = data.notifications || [];
    } else {
      notifications.value.push(...(data.notifications || []));
    }

    totalPages.value = data.totalPages || 0;
    currentPage.value = page;
    isLoadFailed.value = false;
    retryCount.value = 0;
  } catch (error) {
    console.error('Error fetching notifications:', error);
    retryCount.value += 1;
    if (retryCount.value >= maxRetries) {
      isLoadFailed.value = true;
    }
  } finally {
    isLoading.value = false;
    initialLoading.value = false;
  }
};

const loadMoreNotifications = () => {
  if (currentPage.value < totalPages.value) {
    fetchNotifications(currentPage.value + 1);
  }
};

const handleScroll = () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
    loadMoreNotifications();
  }
};

const connectSSE = async () => {
  if (!user.value?.email) {
    console.debug('SSE connection not initiated: User not logged in');
    return;
  }

  try {
    const deviceFingerprint = await getCombinedFingerprint(user.value.email);
    const sseUrl = `/api/stream?fingerprint=${encodeURIComponent(deviceFingerprint)}`;

    console.debug('Attempting to connect SSE:', sseUrl);

    eventSource = new EventSource(sseUrl);

    eventSource.onopen = (event) => {
      console.debug('SSE connection established', event);
    };

    eventSource.addEventListener('newNotification', (event) => {
      console.debug('Received raw SSE message:', event);
      try {
        const newNotification = JSON.parse(event.data);
        handleNewNotification(newNotification);
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    });

    eventSource.addEventListener('error', (error) => {
      console.error('SSE error:', error);
      eventSource?.close();
      setTimeout(() => {
        console.debug('Attempting to reconnect SSE...');
        connectSSE();
      }, 5000);
    });
  } catch (error) {
    console.error('Error setting up SSE:', error);
  }
};

const handleNotificationDeleted = (deletedId: string) => {
  const index = notifications.value.findIndex((n) => n.id === deletedId);
  if (index !== -1) {
    notifications.value[index].isDeleting = true;
    setTimeout(() => {
      notifications.value = notifications.value.filter((n) => n.id !== deletedId);
    }, 500); // This should match the duration of your animation
  }
};

const handleNewNotification = (newNotification: Notification) => {
  newNotification.isNew = true;
  notifications.value.unshift(newNotification);
  setTimeout(() => {
    const index = notifications.value.findIndex((n) => n.id === newNotification.id);
    if (index !== -1) {
      notifications.value[index].isNew = false;
    }
  }, 500); // This should match the duration of your animation
};

const retryFetchNotifications = () => {
  isLoadFailed.value = false;
  retryCount.value = 0;
  fetchNotifications(currentPage.value);
};

onMounted(() => {
  if (user.value?.email) {
    connectSSE();
    if (notifications.value.length === 0) {
      fetchNotifications(1);
    }
    window.addEventListener('scroll', handleScroll);
  } else {
    console.debug('User not logged in, skipping SSE connection and initial fetch');
  }
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
  }
  window.removeEventListener('scroll', handleScroll);
});

watch(
  () => user.value,
  (newUser) => {
    if (newUser?.email) {
      connectSSE();
    } else if (eventSource) {
      console.debug('User logged out, closing SSE connection');
      eventSource.close();
      eventSource = null;
    }
  },
);
</script>

<template>
  <div class="flex flex-col items-center w-full">
    <div class="w-full pb-6 box-border">
      <template v-if="user">
        <template v-if="!initialLoading">
          <TransitionGroup
            v-if="notifications.length > 0"
            name="notification-list"
            tag="div"
            class="space-y-4"
            id="notification-list"
          >
            <NotificationCard
              v-for="notification in notifications"
              :key="notification.id"
              :notification="notification"
              @deleted="handleNotificationDeleted"
            />
          </TransitionGroup>
          <Card v-else>
            <CardContent class="flex items-center justify-center p-6">
              <p class="text-muted-foreground">There's no notification here...</p>
            </CardContent>
          </Card>
        </template>
        <div v-if="isLoading" class="flex justify-center mt-4">
          <Icon icon="mdi:loading" class="animate-spin h-6 w-6 text-primary" />
        </div>
        <div v-if="isLoadFailed" class="flex flex-col items-center mt-4">
          <p class="text-red-500 text-xs">Failed to load notifications. Please try again.</p>
          <Button class="mt-2" variant="outline" @click="retryFetchNotifications">Retry</Button>
        </div>
      </template>
      <Card v-else>
        <CardContent class="flex items-center justify-center">
          <Login />
        </CardContent>
      </Card>
    </div>
  </div>
</template>

<style module>
.notification-list-enter-active,
.notification-list-leave-active {
  transition: all 0.5s ease;
}

.notification-list-enter-from {
  opacity: 0;
  transform: translateX(100%);
}

.notification-list-leave-to {
  opacity: 0;
  transform: translateX(-100%);
}

.notification-list-move {
  transition: transform 0.5s ease;
}
</style>

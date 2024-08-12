<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

import { Icon } from '@iconify/vue';
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
const loading = ref(false);
const initialLoading = ref(false);

let eventSource: EventSource | null = null;

const fetchNotifications = async (page: number) => {
  if (loading.value) return;
  loading.value = true;

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
  } catch (error) {
    console.error('Error fetching notifications:', error);
  } finally {
    loading.value = false;
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
        notifications.value.unshift(JSON.parse(event.data));
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
          <div v-if="notifications.length > 0" class="space-y-4" id="notification-list">
            <NotificationCard v-for="notification in notifications" :key="notification.id" :notification="notification" />
          </div>
          <Card v-else>
            <CardContent class="flex items-center justify-center p-6">
              <p class="text-muted-foreground">There's no notification here...</p>
            </CardContent>
          </Card>
        </template>
        <div v-if="loading" class="flex justify-center mt-4">
          <Icon icon="mdi:loading" class="animate-spin h-6 w-6 text-primary" />
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
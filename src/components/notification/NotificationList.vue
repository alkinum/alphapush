<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Notification } from '@/types/notification';

import { useSSEConnection } from './composable/useSSEConnection';
import { useNotificationsData } from './composable/useNotificationsData';
import { useNotificationFilters, type Category, type Group } from './composable/useNotificationFilters';

import Login from '../user/Login.vue';
import NotificationCard from './NotificationCard.vue';
import NotificationGroupSwitch from './NotificationGroupSwitch.vue';

interface Props {
  session: {
    user?: {
      email: string;
      name?: string | null;
    } | null;
  } | null;
  initialNotifications: Notification[];
  initialTotalPages: number;
  initialGroups?: Group[];
  initialCategories?: Category[];
  categoriesByGroup?: Record<string, Category[]>;
}

const props = withDefaults(defineProps<Props>(), {
  initialGroups: () => [],
  initialCategories: () => [],
  categoriesByGroup: () => ({ all: [] }),
});

// User information
const user = ref(props.session?.user);
const userEmail = ref<string | undefined>(user.value?.email || undefined);

// Watch for user email changes
watch(
  () => user.value?.email,
  (newEmail) => {
    userEmail.value = newEmail || undefined;
  },
);

// Initialize notification filters
const { currentGroup, currentCategory, processNewNotification, switchToNotificationContext, initializeKnownFilters } =
  useNotificationFilters('all', 'all');

// Initialize notifications data
const {
  notifications,
  currentPage,
  isLoading,
  initialLoading,
  isLoadFailed,
  fetchNotifications,
  loadMoreNotifications,
  retryFetchNotifications,
  handleNotificationDeleted,
  handleNewNotification,
  handleUpdateNotification,
  fetchNotificationById,
  highlightNotification,
} = useNotificationsData(props.initialNotifications);

// Handle filter changes from NotificationGroupSwitch
const handleFilterChange = (group: string, category: string) => {
  currentGroup.value = group;
  currentCategory.value = category;
  currentPage.value = 1; // Reset to first page
  fetchNotifications(1, group, category);
};

// Custom switch to notification context for the handleNewNotification function
const customSwitchToNotificationContext = (notification: Notification) => {
  switchToNotificationContext(notification, handleFilterChange);

  // Highlight the notification after data is loaded
  if (notification.id) {
    setTimeout(() => {
      highlightNotification(notification.id, notification.group, notification.category);
    }, 500);
  }
};

// Handle scroll for infinite loading
const handleScroll = () => {
  if (window.innerHeight + window.scrollY >= document.body.offsetHeight - 100) {
    loadMoreNotifications(currentGroup.value, currentCategory.value);
  }
};

// Process notifications from SSE
const processNotificationFromSSE = (notification: Notification) => {
  processNewNotification(notification);
};

// Handle update notification from SSE
const handleNotificationUpdateFromSSE = (notification: Notification) => {
  handleUpdateNotification(notification, currentGroup, currentCategory);
};

// Initialize SSE connection
const { connect, disconnect } = useSSEConnection(userEmail, {
  onNewNotification: (notification) => {
    processNotificationFromSSE(notification);
    handleNewNotification(notification, currentGroup, currentCategory, customSwitchToNotificationContext);
  },
  onUpdateNotification: handleNotificationUpdateFromSSE,
  onDeleteNotification: handleNotificationDeleted,
});

// Fetch notification details by ID
const handleNotificationIdFromRoute = (notificationId: string) => {
  console.log(`Found notificationId in page data: ${notificationId}`);

  fetchNotificationById(notificationId, (notification) => {
    // If notification has a group, select it
    if (notification.group && notification.group !== currentGroup.value) {
      const groupName = notification.group;
      currentGroup.value = groupName;
      // When changing group, reset category to 'all'
      currentCategory.value = 'all';
      // Fetch notifications with the new filter
      fetchNotifications(1, groupName, 'all');

      // Highlight the notification
      setTimeout(() => {
        highlightNotification(notificationId, groupName, 'all');
      }, 500);
    } else {
      // Just highlight the notification
      highlightNotification(notificationId, currentGroup.value, currentCategory.value);
    }
  });
};

onMounted(() => {
  if (userEmail.value) {
    // Initialize known filters
    initializeKnownFilters(props.initialCategories, props.initialGroups);

    // Connect to SSE
    connect();

    // Fetch notifications if needed
    if (notifications.value.length === 0) {
      fetchNotifications(1, currentGroup.value, currentCategory.value);
    }

    // Setup scroll listener
    window.addEventListener('scroll', handleScroll);

    // Listen for reconnect event
    document.addEventListener('reconnectSSE', () => {
      console.log('Reconnecting SSE after subscription update...');
      disconnect();
      connect();
    });

    // Check for notificationId in body data attribute
    const notificationId = document.body.getAttribute('data-notification-id');
    if (notificationId) {
      handleNotificationIdFromRoute(notificationId);
    }
  } else {
    console.log('User not logged in, skipping SSE connection and initial fetch');
  }
});

onUnmounted(() => {
  disconnect();
  window.removeEventListener('scroll', handleScroll);
  document.removeEventListener('reconnectSSE', () => {});
});

// Watch for user changes
watch(
  () => user.value,
  (newUser) => {
    if (newUser?.email) {
      connect();
    } else {
      console.log('User logged out, closing SSE connection');
      disconnect();
    }
  },
);
</script>

<template>
  <div class="flex flex-col items-center w-full">
    <div class="w-full pb-6 box-border">
      <template v-if="user">
        <!-- Add the filter component -->
        <NotificationGroupSwitch
          :initialGroup="currentGroup"
          :initialCategory="currentCategory"
          :initialGroups="props.initialGroups"
          :initialCategories="props.initialCategories"
          :categoriesByGroup="props.categoriesByGroup"
          @filterChange="handleFilterChange"
        />

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
          <Button class="mt-2" variant="outline" @click="retryFetchNotifications(currentGroup, currentCategory)"
            >Retry</Button
          >
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

<style>
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

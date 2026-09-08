<script setup lang="ts">
import { ref, computed, nextTick, onMounted, onUnmounted, watch } from 'vue';
import { Icon } from '@iconify/vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { useToast } from '@/components/ui/sonner/use-toast';
import PullToRefresh from '@/components/ui/pull-to-refresh/PullToRefresh.vue';
import type { Notification } from '@/types/notification';

import { useSSEConnection } from './composable/useSSEConnection';
import { useNotificationsData } from './composable/useNotificationsData';
import { useNotificationFilters, type Category, type Group } from './composable/useNotificationFilters';

import Login from '../user/Login.vue';
import NotificationCard from './NotificationCard.vue';
import NotificationGroupSwitch from './NotificationGroupSwitch.vue';
import DeleteConfirmationDialog from './DeleteConfirmationDialog.vue';

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
  enablePullToRefresh?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  initialGroups: () => [],
  initialCategories: () => [],
  categoriesByGroup: () => ({ all: [] }),
  enablePullToRefresh: true,
});

const { toast } = useToast();

// User information
const user = ref(props.session?.user);
const userEmail = ref<string | undefined>(user.value?.email || undefined);
const selectionMode = ref(false);
const selectedNotificationIds = ref<Set<string>>(new Set());
const showBatchDeleteDialog = ref(false);
const isDeletingSelected = ref(false);
let visibilitySyncInterval: number | null = null;
let loadMoreObserver: IntersectionObserver | null = null;
let loadMoreFrame: number | null = null;
const loadMoreSentinel = ref<HTMLElement | null>(null);
const isLoadTriggerVisible = ref(false);
const selectedCount = computed(() => selectedNotificationIds.value.size);
const selectedDeleteDescription = computed(() => {
  const count = selectedCount.value;
  return `Are you sure you want to delete ${count} selected notification${count === 1 ? '' : 's'}? This action cannot be undone.`;
});

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
  markNotificationsReadLocally,
  handleNewNotification,
  handleUpdateNotification,
  fetchNotificationById,
  highlightNotification,
  hasMoreNotifications,
} = useNotificationsData(props.initialNotifications, props.initialTotalPages);

const hasNotifications = computed(() => notifications.value.length > 0);

const clearSelection = () => {
  selectedNotificationIds.value = new Set();
  selectionMode.value = false;
  showBatchDeleteDialog.value = false;
};

const enterSelectionMode = (notificationId?: string) => {
  selectionMode.value = true;

  if (notificationId) {
    const nextSelection = new Set(selectedNotificationIds.value);
    nextSelection.add(notificationId);
    selectedNotificationIds.value = nextSelection;
  }
};

const toggleNotificationSelection = (notificationId: string) => {
  const nextSelection = new Set(selectedNotificationIds.value);

  if (nextSelection.has(notificationId)) {
    nextSelection.delete(notificationId);
  } else {
    nextSelection.add(notificationId);
  }

  selectedNotificationIds.value = nextSelection;

  if (nextSelection.size === 0) {
    selectionMode.value = false;
  }
};

const selectAllVisibleNotifications = () => {
  selectedNotificationIds.value = new Set(notifications.value.map((notification) => notification.id));
  selectionMode.value = true;
};

const handleDeleteSelected = async () => {
  const notificationIds = Array.from(selectedNotificationIds.value);

  if (notificationIds.length === 0) {
    showBatchDeleteDialog.value = false;
    return;
  }

  try {
    isDeletingSelected.value = true;
    const response = await fetch('/api/notifications', {
      method: 'DELETE',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ notificationIds }),
    });

    if (!response.ok) {
      const errorData = (await response.json().catch(() => ({}))) as { error?: string };
      throw new Error(errorData.error || 'Failed to delete selected notifications');
    }

    const result = (await response.json()) as { deletedIds?: string[] };
    const deletedIds = result.deletedIds || notificationIds;

    deletedIds.forEach((deletedId) => handleNotificationDeleted(deletedId));
    clearSelection();

    toast({
      title: 'Notifications deleted',
      description: `${deletedIds.length} notification${deletedIds.length === 1 ? '' : 's'} deleted.`,
    });
  } catch (error) {
    console.error('Failed to delete selected notifications:', error);
    toast({
      title: 'Deletion failed',
      description: error instanceof Error ? error.message : 'Unable to delete selected notifications.',
      variant: 'destructive',
    });
  } finally {
    isDeletingSelected.value = false;
  }
};

// Handle filter changes from NotificationGroupSwitch
const handleFilterChange = (group: string, category: string) => {
  clearSelection();
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

// Observe the list end regardless of whether the window or mobile body scrolls.
const scheduleLoadMore = () => {
  if (loadMoreFrame !== null || !isLoadTriggerVisible.value || !hasMoreNotifications.value || isLoading.value || isLoadFailed.value) return;
  loadMoreFrame = window.requestAnimationFrame(async () => {
    loadMoreFrame = null;
    if (!loadMoreSentinel.value || loadMoreSentinel.value.getBoundingClientRect().top > window.innerHeight + 300) return;
    await loadMoreNotifications(currentGroup.value, currentCategory.value);
  });
};
const setupLoadMoreObserver = () => {
  loadMoreObserver?.disconnect();
  isLoadTriggerVisible.value = false;
  if (!loadMoreSentinel.value) return;
  loadMoreObserver = new IntersectionObserver(([entry]) => {
    isLoadTriggerVisible.value = entry?.isIntersecting ?? false;
    scheduleLoadMore();
  }, { rootMargin: '300px 0px' });
  loadMoreObserver.observe(loadMoreSentinel.value);
};
watch(loadMoreSentinel, () => { void nextTick(setupLoadMoreObserver); });
watch([isLoading, hasMoreNotifications], () => { void nextTick(scheduleLoadMore); });

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

// Handle reconnectSSE event
const handleReconnectSSE = () => {
  console.log('Reconnecting SSE...');
  disconnect();
  setTimeout(() => {
    connect();
  }, 1000);
};

const handleNotificationsRead = (event: Event) => {
  const detail = (event as CustomEvent<{
    all?: boolean;
    readAt?: string;
    notificationIds?: string[];
  }>).detail;

  if (!detail?.readAt) {
    return;
  }

  markNotificationsReadLocally(detail.notificationIds, detail.readAt, !!detail.all);
};

const handleServiceWorkerNotification = (event: Event) => {
  const detail = (event as CustomEvent<{ notification?: Notification; source?: string }>).detail;
  if (detail?.source !== 'service-worker' || !detail.notification?.id) {
    return;
  }

  processNotificationFromSSE(detail.notification);
  handleNewNotification(
    detail.notification,
    currentGroup,
    currentCategory,
    customSwitchToNotificationContext
  );
};

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

// Pull to refresh handler
const handleRefresh = async () => {
  try {
    clearSelection();
    // Reset page to 1 and fetch fresh notifications
    currentPage.value = 1;
    await fetchNotifications(1, currentGroup.value, currentCategory.value);
    return Promise.resolve();
  } catch (error) {
    console.error('Failed to refresh notifications:', error);
    return Promise.reject(error);
  }
};

const syncVisibleNotifications = () => {
  if (document.visibilityState === 'visible' && userEmail.value) {
    if (!isLoading.value && !isLoadFailed.value) {
      void fetchNotifications(1, currentGroup.value, currentCategory.value, { preserveExisting: true });
    }
  }
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

    setupLoadMoreObserver();

    // Setup reconnect listener for SSE
    document.addEventListener('reconnectSSE', handleReconnectSSE as EventListener);
    document.addEventListener('alphapush:notifications-read', handleNotificationsRead as EventListener);
    document.addEventListener('alphapush:new-notification', handleServiceWorkerNotification as EventListener);
    window.addEventListener('focus', syncVisibleNotifications);
    visibilitySyncInterval = window.setInterval(syncVisibleNotifications, 60_000);

    // Entering the app marks currently visible notifications as read.
    markNotificationsReadLocally(undefined, new Date(), true);

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
  loadMoreObserver?.disconnect();
  if (loadMoreFrame !== null) window.cancelAnimationFrame(loadMoreFrame);
  document.removeEventListener('reconnectSSE', handleReconnectSSE as EventListener);
  document.removeEventListener('alphapush:notifications-read', handleNotificationsRead as EventListener);
  document.removeEventListener('alphapush:new-notification', handleServiceWorkerNotification as EventListener);
  window.removeEventListener('focus', syncVisibleNotifications);
  if (visibilitySyncInterval !== null) {
    window.clearInterval(visibilitySyncInterval);
    visibilitySyncInterval = null;
  }
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

watch(notifications, (currentNotifications) => {
  if (!selectionMode.value) {
    return;
  }

  const visibleIds = new Set(currentNotifications.map((notification) => notification.id));
  const nextSelection = new Set(
    Array.from(selectedNotificationIds.value).filter((notificationId) => visibleIds.has(notificationId))
  );

  if (nextSelection.size !== selectedNotificationIds.value.size) {
    selectedNotificationIds.value = nextSelection;
  }

  if (nextSelection.size === 0) {
    selectionMode.value = false;
  }
});
</script>

<template>
  <div class="flex flex-col items-center w-full">
    <div class="w-full pb-6 box-border">
      <template v-if="user">
        <!-- Use the new PullToRefresh component -->
        <PullToRefresh :onRefresh="handleRefresh" :enabled="props.enablePullToRefresh">
          <!-- Content wrapper -->
          <div class="content-wrapper">
            <!-- Add the filter component -->
            <NotificationGroupSwitch
              :initialGroup="currentGroup"
              :initialCategory="currentCategory"
              :initialGroups="props.initialGroups"
              :initialCategories="props.initialCategories"
              :categoriesByGroup="props.categoriesByGroup"
              @filterChange="handleFilterChange"
            />

            <div v-if="hasNotifications" class="items-center justify-end gap-2 mb-3" :class="selectionMode ? 'flex' : 'hidden md:flex'">
              <template v-if="selectionMode">
                <span class="mr-auto text-sm font-medium text-muted-foreground">{{ selectedCount }} selected</span>
                <Button variant="ghost" size="sm" @click="selectAllVisibleNotifications">Select all</Button>
                <Button variant="ghost" size="sm" @click="clearSelection">Cancel</Button>
                <Button
                  variant="destructive"
                  size="sm"
                  :disabled="selectedCount === 0 || isDeletingSelected"
                  @click="showBatchDeleteDialog = true"
                >
                  <Icon icon="mdi:delete" class="mr-1.5 h-4 w-4" />
                  Delete
                </Button>
              </template>
              <Button v-else variant="outline" size="sm" @click="enterSelectionMode()">
                <Icon icon="mdi:checkbox-multiple-marked-outline" class="mr-1.5 h-4 w-4" />
                Select
              </Button>
            </div>

            <div class="notification-content">
              <template v-if="!initialLoading">
                <div v-if="notifications.length > 0" class="space-y-4" id="notification-list">
                  <NotificationCard
                    v-for="notification in notifications"
                    :key="notification.id"
                    :notification="notification"
                    :selection-enabled="true"
                    :selection-mode="selectionMode"
                    :selected="selectedNotificationIds.has(notification.id)"
                    @deleted="handleNotificationDeleted"
                    @selection-start="enterSelectionMode"
                    @selection-toggle="toggleNotificationSelection"
                  />
                </div>
                <Card v-else>
                  <CardContent class="flex items-center justify-center p-6">
                    <p class="text-muted-foreground">There's no notification here...</p>
                  </CardContent>
                </Card>
              </template>
              <div v-if="hasMoreNotifications" ref="loadMoreSentinel" class="h-px" aria-hidden="true"></div>
              <div v-if="isLoading" class="flex justify-center mt-4 overflow-hidden">
                <Icon icon="mdi:loading" class="animate-spin h-6 w-6 text-primary" />
              </div>
              <div v-if="isLoadFailed" class="flex flex-col items-center mt-4">
                <p class="text-red-500 text-xs">Failed to load notifications. Please try again.</p>
                <Button class="mt-2" variant="outline" @click="retryFetchNotifications(currentGroup, currentCategory)"
                  >Retry</Button
                >
              </div>
            </div>
          </div>
        </PullToRefresh>
      </template>
      <Card v-else class="w-full mb-4 overflow-hidden">
        <Login />
      </Card>
    </div>
    <DeleteConfirmationDialog
      v-if="showBatchDeleteDialog"
      :isOpen="showBatchDeleteDialog"
      title="Delete selected notifications"
      :description="selectedDeleteDescription"
      confirmLabel="Delete"
      @confirm="handleDeleteSelected"
      @cancel="showBatchDeleteDialog = false"
      @update:isOpen="(value) => (showBatchDeleteDialog = value)"
    />
  </div>
</template>

<style>
.content-wrapper {
  transition: transform 0.2s cubic-bezier(0.25, 0.46, 0.45, 0.94);
  will-change: transform;
}

.notification-content {
  position: relative;
}
</style>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue';

import { Icon } from '@iconify/vue';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import type { Notification } from '@/types/notification';
import { getCombinedFingerprint } from '@/utils/fingerprint';
import { StreamErrorCode } from '@/pages/api/stream';

import Login from '../user/Login.vue';
import NotificationCard from './NotificationCard.vue';
import NotificationGroupSwitch from './NotificationGroupSwitch.vue';

interface Category {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
}

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
}

const props = withDefaults(defineProps<Props>(), {
  initialGroups: () => [],
  initialCategories: () => [],
});

const user = ref(props.session?.user);

const notifications = ref<Notification[]>(props.initialNotifications);
const totalPages = ref(props.initialTotalPages);
const currentPage = ref(1);
const initialLoading = ref(false);
const isLoading = ref(false);
const isLoadFailed = ref(false);
const retryCount = ref(0);
const maxRetries = 3;

// Add filter state
const currentGroup = ref('all');
const currentCategory = ref('all');

// Track known categories and groups to detect new ones
const knownCategories = new Set<string>();
const knownGroups = new Set<string>();

/**
 * Initialize the known categories and groups from the provided arrays
 */
function initializeKnownFilters(
  categories: Array<{ id: string; name: string }>,
  groups: Array<{ id: string; name: string }>,
) {
  // Clear existing sets
  knownCategories.clear();
  knownGroups.clear();

  // Add all categories and groups to the sets
  categories.forEach((category) => {
    if (category.id !== 'all') {
      knownCategories.add(category.id);
    }
  });

  groups.forEach((group) => {
    if (group.id !== 'all') {
      knownGroups.add(group.id);
    }
  });
}

/**
 * Process new notification and check for new categories or groups
 */
function processNewNotification(notification: any) {
  // Check if the notification has a new category
  if (notification.category && !knownCategories.has(notification.category)) {
    knownCategories.add(notification.category);
    // Dispatch event for new category
    document.dispatchEvent(
      new CustomEvent('newNotificationCategory', {
        detail: {
          category: notification.category,
        },
      }),
    );
  }

  // Check if the notification has a new group
  if (notification.group && !knownGroups.has(notification.group)) {
    knownGroups.add(notification.group);
    // Dispatch event for new group
    document.dispatchEvent(
      new CustomEvent('newNotificationGroup', {
        detail: {
          group: notification.group,
        },
      }),
    );
  }

  // Dispatch event for the notification itself
  document.dispatchEvent(
    new CustomEvent('notificationReceived', {
      detail: { notification },
    }),
  );
}

let eventSource: EventSource | null = null;

// Define error response type
interface ErrorResponse {
  error: string;
  code: StreamErrorCode;
}

// Define user fingerprints interface
interface UserFingerprints {
  [userEmail: string]: string;
}

const fetchNotifications = async (
  page: number,
  group: string = currentGroup.value,
  category: string = currentCategory.value,
) => {
  if (isLoading.value || isLoadFailed.value) {
    return;
  }
  isLoading.value = true;

  try {
    const response = await fetch(`/api/notifications?page=${page}&pageSize=10&group=${group}&category=${category}`);
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
    fetchNotifications(currentPage.value + 1, currentGroup.value, currentCategory.value);
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
    // Get fingerprints from storage
    const userFingerprints = localStorage.getItem('userFingerprints');
    let fingerprints: UserFingerprints = {};

    try {
      fingerprints = userFingerprints ? JSON.parse(userFingerprints) : {};
    } catch (error) {
      console.error('Error parsing stored fingerprints:', error);
    }

    // Get fingerprint for current user or generate a new one
    const deviceFingerprint =
      (fingerprints && fingerprints[user.value.email]) || (await getCombinedFingerprint(user.value.email));

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
        // Process the notification with the shared handler
        processNewNotification(newNotification);
        // Handle the notification in the UI
        handleNewNotification(newNotification);
      } catch (error) {
        console.error('Error parsing SSE data:', error);
      }
    });

    eventSource.addEventListener('error', (event) => {
      console.error('SSE error:', event);

      // Check if the error is due to an HTTP error response
      if (event.target && (event.target as EventSource).readyState === EventSource.CLOSED) {
        // Try to get the error details from the response
        fetch(sseUrl, { method: 'GET' })
          .then(async (response) => {
            if (!response.ok) {
              const errorData = (await response.json()) as ErrorResponse;

              // Check if it's an invalid fingerprint error
              if (errorData.code === StreamErrorCode.INVALID_FINGERPRINT) {
                console.debug('Invalid fingerprint detected in SSE connection');

                // Dispatch an event to handle the error at the application level
                window.dispatchEvent(
                  new CustomEvent('SSEConnectionError', {
                    detail: {
                      error: errorData.error,
                      code: errorData.code,
                    },
                  }),
                );

                // Don't try to reconnect immediately, let the event handler handle it
                return;
              }
            }

            // For other errors, try to reconnect
            eventSource?.close();
            setTimeout(() => {
              console.debug('Attempting to reconnect SSE...');
              connectSSE();
            }, 5000);
          })
          .catch((error) => {
            console.error('Error checking SSE connection status:', error);
            // For network errors, try to reconnect
            eventSource?.close();
            setTimeout(() => {
              console.debug('Attempting to reconnect SSE after fetch error...');
              connectSSE();
            }, 5000);
          });
      } else {
        // For other types of errors, try to reconnect
        eventSource?.close();
        setTimeout(() => {
          console.debug('Attempting to reconnect SSE...');
          connectSSE();
        }, 5000);
      }
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
      handleScroll(); // Manually trigger scroll event to load more notifications
    }, 500); // This should match the duration of your animation
  }
};

const handleNewNotification = (newNotification: Notification) => {
  // Only add the notification if it matches the current filter
  if (
    (currentGroup.value === 'all' || newNotification.group === currentGroup.value) &&
    (currentCategory.value === 'all' || newNotification.category === currentCategory.value)
  ) {
    newNotification.isNew = true;
    notifications.value.unshift(newNotification);
    setTimeout(() => {
      const index = notifications.value.findIndex((n) => n.id === newNotification.id);
      if (index !== -1) {
        notifications.value[index].isNew = false;
      }
    }, 500); // This should match the duration of your animation
  }
};

const retryFetchNotifications = () => {
  isLoadFailed.value = false;
  retryCount.value = 0;
  fetchNotifications(currentPage.value, currentGroup.value, currentCategory.value);
};

// Handle filter changes
const handleFilterChange = (group: string, category: string) => {
  currentGroup.value = group;
  currentCategory.value = category;
  currentPage.value = 1; // Reset to first page
  fetchNotifications(1, group, category);
};

onMounted(() => {
  if (user.value?.email) {
    // Initialize known filters
    initializeKnownFilters(props.initialCategories, props.initialGroups);

    connectSSE();
    if (notifications.value.length === 0) {
      fetchNotifications(1);
    }
    window.addEventListener('scroll', handleScroll);

    // Listen for reconnect event
    document.addEventListener('reconnectSSE', () => {
      console.debug('Reconnecting SSE after subscription update...');
      if (eventSource) {
        eventSource.close();
      }
      connectSSE();
    });

    // Check for notificationId in body data attribute
    const notificationId = document.body.getAttribute('data-notification-id');

    if (notificationId) {
      console.debug(`Found notificationId in page data: ${notificationId}`);
      // Fetch the specific notification to get its group and category
      fetchNotificationDetails(notificationId);
    }
  } else {
    console.debug('User not logged in, skipping SSE connection and initial fetch');
  }
});

onUnmounted(() => {
  if (eventSource) {
    eventSource.close();
  }
  window.removeEventListener('scroll', handleScroll);
  document.removeEventListener('reconnectSSE', () => {});
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

// Function to fetch notification details by ID
const fetchNotificationDetails = async (notificationId: string) => {
  try {
    const response = await fetch(`/api/notifications?id=${notificationId}`);
    if (!response.ok) {
      console.error('Failed to fetch notification details');
      return;
    }

    const data = (await response.json()) as { notification?: Notification };
    if (data.notification) {
      const notification = data.notification;

      // If notification has a group, select it
      if (notification.group && notification.group !== currentGroup.value) {
        currentGroup.value = notification.group;
        // When changing group, reset category to 'all'
        currentCategory.value = 'all';
        // Fetch notifications with the new filter
        fetchNotifications(1, notification.group, 'all');

        // Highlight the notification
        setTimeout(() => {
          highlightNotification(notificationId);
        }, 500);
      } else {
        // Just highlight the notification
        highlightNotification(notificationId);
      }
    }
  } catch (error) {
    console.error('Error fetching notification details:', error);
  }
};

// Function to highlight a notification
const highlightNotification = (notificationId: string) => {
  // Find the notification in the current list
  const index = notifications.value.findIndex((n) => n.id === notificationId);

  if (index !== -1) {
    // Set highlight flag - using type assertion since we know this is a UI-only property
    (notifications.value[index] as Notification & { highlight?: boolean }).highlight = true;

    // Scroll to the notification
    setTimeout(() => {
      const element = document.getElementById(`notification-${notificationId}`);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }

      // Remove highlight after a delay
      setTimeout(() => {
        const updatedIndex = notifications.value.findIndex((n) => n.id === notificationId);
        if (updatedIndex !== -1) {
          (notifications.value[updatedIndex] as Notification & { highlight?: boolean }).highlight = false;
        }
      }, 3000);
    }, 100);
  } else {
    // If notification not found in current list, try to fetch it
    fetchNotifications(1, currentGroup.value, currentCategory.value);
  }
};
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

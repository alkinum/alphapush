import { ref, computed, shallowRef } from 'vue';
import type { Ref } from 'vue';
import type { Notification } from '@/types/notification';
import { useToast } from '@/components/ui/sonner/use-toast';

// Extended notification type with UI-specific properties
export interface UINotification extends Notification {
  isDeleting?: boolean;
  isNew?: boolean;
  highlight?: boolean;
}

/**
 * Composable for managing notification data and operations
 */
interface FetchNotificationsOptions {
  preserveExisting?: boolean;
}

export function useNotificationsData(initialNotifications: Notification[] = [], initialTotalPages = 0) {
  const { toast } = useToast();
  const notifications = shallowRef<UINotification[]>([...(initialNotifications as UINotification[])]);
  const totalPages = ref(initialTotalPages);
  const currentPage = ref(1);
  const isLoading = ref(false);
  const initialLoading = ref(false);
  const isLoadFailed = ref(false);
  const failedPage = ref<number | null>(null);
  let activeRequest: AbortController | null = null;
  let requestSequence = 0;

  // Computed property for empty state
  const isEmpty = computed(() => notifications.value.length === 0);
  const hasMoreNotifications = computed(() => currentPage.value < totalPages.value);

  const mergeUniqueNotifications = (existing: UINotification[], incoming: Notification[]) => {
    const seenIds = new Set(existing.map((notification) => notification.id));
    const uniqueIncoming = incoming.filter((notification) => {
      if (seenIds.has(notification.id)) return false;
      seenIds.add(notification.id);
      return true;
    }) as UINotification[];
    return [...existing, ...uniqueIncoming];
  };

  const updateNotification = (
    notificationId: string,
    update: (notification: UINotification) => UINotification,
  ) => {
    notifications.value = notifications.value.map((notification) =>
      notification.id === notificationId ? update(notification) : notification
    );
  };

  /**
   * Fetch notifications from the API
   */
  const fetchNotifications = async (
    page: number,
    group: string = '',
    category: string = '',
    options: FetchNotificationsOptions = {},
  ) => {
    if (isLoading.value && page !== 1) {
      return false;
    }

    if (page === 1) {
      activeRequest?.abort();
      isLoadFailed.value = false;
    } else if (isLoadFailed.value || page > totalPages.value) {
      return false;
    }

    const requestId = ++requestSequence;
    const controller = new AbortController();
    activeRequest = controller;
    isLoading.value = true;

    try {
      // Construct the URL with only valid parameters
      let url = `/api/notifications?page=${page}&pageSize=10`;
      if (group && group !== 'all') url += `&group=${encodeURIComponent(group)}`;
      if (category && category !== 'all') url += `&category=${encodeURIComponent(category)}`;

      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch notifications (${response.status})`);
      }

      const data: { notifications: Notification[]; totalPages: number } = await response.json();
      if (requestId !== requestSequence) {
        return false;
      }

      if (page === 1) {
        const firstPage = (data.notifications || []) as UINotification[];
        notifications.value = options.preserveExisting
          ? mergeUniqueNotifications(firstPage, notifications.value)
          : firstPage;
      } else {
        notifications.value = mergeUniqueNotifications(notifications.value, data.notifications || []);
      }

      totalPages.value = data.totalPages || 0;
      currentPage.value = options.preserveExisting ? Math.max(currentPage.value, page) : page;
      isLoadFailed.value = false;
      failedPage.value = null;
      return true;
    } catch (error) {
      if (requestId !== requestSequence || controller.signal.aborted) {
        return false;
      }

      console.error('Error fetching notifications:', error);
      failedPage.value = page;
      isLoadFailed.value = true;
      return false;
    } finally {
      if (requestId === requestSequence) {
        isLoading.value = false;
        initialLoading.value = false;
        activeRequest = null;
      }
    }
  };

  /**
   * Load more notifications (for pagination)
   */
  const loadMoreNotifications = async (group: string = '', category: string = '') => {
    if (!hasMoreNotifications.value || isLoading.value || isLoadFailed.value) {
      return false;
    }

    return fetchNotifications(currentPage.value + 1, group, category);
  };

  /**
   * Retry fetching notifications after a failure
   */
  const retryFetchNotifications = (group: string = '', category: string = '') => {
    isLoadFailed.value = false;
    const page = failedPage.value ?? Math.max(1, currentPage.value);
    return fetchNotifications(page, group, category);
  };

  /**
   * Handle notification deletion
   */
  const handleNotificationDeleted = (deletedId: string) => {
    const index = notifications.value.findIndex((n) => n.id === deletedId);
    if (index !== -1) {
      updateNotification(deletedId, (notification) => ({ ...notification, isDeleting: true }));
      setTimeout(() => {
        notifications.value = notifications.value.filter((n) => n.id !== deletedId);
      }, 500); // This should match the duration of your animation
    }
  };

  /**
   * Update local read state after badge/read synchronization.
   */
  const markNotificationsReadLocally = (
    notificationIds: string[] | undefined,
    readAt: string | Date,
    all = false
  ) => {
    const readAtDate = readAt instanceof Date ? readAt : new Date(readAt);
    const notificationIdSet = new Set(notificationIds || []);

    notifications.value = notifications.value.map((notification) => {
      if (all || notificationIdSet.has(notification.id)) {
        return {
          ...notification,
          readAt: notification.readAt || readAtDate,
        };
      }

      return notification;
    });
  };

  /**
   * Handle a new notification
   */
  const handleNewNotification = (
    newNotification: Notification,
    currentGroup: Ref<string>,
    currentCategory: Ref<string>,
    switchToNotificationContext: (notification: Notification) => void
  ) => {
    // Check if the notification matches the current filter
    const matchesCurrentFilter =
      (currentGroup.value === 'all' || currentGroup.value === '' || newNotification.groupId === currentGroup.value) &&
      (currentCategory.value === 'all' || currentCategory.value === '' || newNotification.categoryId === currentCategory.value);

    if (matchesCurrentFilter) {
      // Add to the current view with animation
      if (notifications.value.some((notification) => notification.id === newNotification.id)) {
        return;
      }

      const uiNotification = { ...newNotification, isNew: true } as UINotification;
      notifications.value = [uiNotification, ...notifications.value];
      setTimeout(() => {
        updateNotification(newNotification.id, (notification) => ({ ...notification, isNew: false }));
      }, 500); // This should match the duration of your animation
    } else {
      // Show toast notification
      toast({
        title: 'New Notification',
        description: newNotification.title || newNotification.content,
        variant: 'default',
        duration: 5000,
        action: {
          label: 'View',
          onClick: () => switchToNotificationContext(newNotification)
        }
      });
    }
  };

  /**
   * Handle notification update
   */
  const handleUpdateNotification = (
    updatedNotification: Notification,
    currentGroup: Ref<string>,
    currentCategory: Ref<string>
  ) => {
    // Find the notification in the current list
    const index = notifications.value.findIndex((n) => n.id === updatedNotification.id);

    if (index !== -1) {
      // Update the existing notification
      updateNotification(updatedNotification.id, (notification) => ({
        ...notification,
        ...updatedNotification,
        highlight: true,
      }));

      // Remove highlight after a delay
      setTimeout(() => {
        updateNotification(updatedNotification.id, (notification) => ({ ...notification, highlight: false }));
      }, 3000);
    } else if (
      (currentGroup.value === 'all' || currentGroup.value === '' || updatedNotification.groupId === currentGroup.value) &&
      (currentCategory.value === 'all' || currentCategory.value === '' || updatedNotification.categoryId === currentCategory.value)
    ) {
      // Notification matches current filter but isn't in the list (could be pagination)
      // Consider refetching first page or handling differently
      const group = currentGroup.value === 'all' ? '' : currentGroup.value;
      const category = currentCategory.value === 'all' ? '' : currentCategory.value;
      fetchNotifications(1, group, category, { preserveExisting: true });
    }
  };

  /**
   * Fetch a specific notification by ID
   */
  const fetchNotificationById = async (
    notificationId: string,
    onSuccess?: (notification: Notification) => void
  ) => {
    try {
      const response = await fetch(`/api/notifications?id=${notificationId}`);
      if (!response.ok) {
        console.error('Failed to fetch notification details');
        return;
      }

      const data = (await response.json()) as { notification?: Notification };
      if (data.notification && onSuccess) {
        onSuccess(data.notification);
      }
    } catch (error) {
      console.error('Error fetching notification details:', error);
    }
  };

  /**
   * Highlight a notification in the list
   */
  const highlightNotification = (
    notificationId: string,
    currentGroup: string | null | undefined = '',
    currentCategory: string | null | undefined = ''
  ) => {
    // Find the notification in the current list
    const index = notifications.value.findIndex((n) => n.id === notificationId);
    const safeGroup = currentGroup === 'all' ? '' : (currentGroup || '');
    const safeCategory = currentCategory === 'all' ? '' : (currentCategory || '');

    if (index !== -1) {
      // Set highlight flag
      updateNotification(notificationId, (notification) => ({ ...notification, highlight: true }));

      // Scroll to the notification
      setTimeout(() => {
        const element = document.getElementById(`notification-${notificationId}`);
        if (element) {
          element.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }

        // Remove highlight after a delay
        setTimeout(() => {
            updateNotification(notificationId, (notification) => ({ ...notification, highlight: false }));
        }, 3000);
      }, 100);
    } else {
      // If notification not found in current list, try to fetch it
      fetchNotifications(1, safeGroup, safeCategory);
    }
  };

  return {
    notifications,
    totalPages,
    currentPage,
    hasMoreNotifications,
    isLoading,
    initialLoading,
    isLoadFailed,
    isEmpty,
    fetchNotifications,
    loadMoreNotifications,
    retryFetchNotifications,
    handleNotificationDeleted,
    markNotificationsReadLocally,
    handleNewNotification,
    handleUpdateNotification,
    fetchNotificationById,
    highlightNotification
  };
}

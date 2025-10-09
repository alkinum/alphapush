import { ref, computed } from 'vue';
import type { Ref } from 'vue';
import type { Notification } from '@/types/notification';
import { useToast } from '@/components/ui/toast/use-toast';

// Extended notification type with UI-specific properties
export interface UINotification extends Notification {
  isDeleting?: boolean;
  isNew?: boolean;
  highlight?: boolean;
}

/**
 * Composable for managing notification data and operations
 */
export function useNotificationsData(initialNotifications: Notification[] = []) {
  const { toast } = useToast();
  const notifications = ref<UINotification[]>(initialNotifications as UINotification[]);
  const totalPages = ref(1);
  const currentPage = ref(1);
  const isLoading = ref(false);
  const initialLoading = ref(false);
  const isLoadFailed = ref(false);
  const retryCount = ref(0);
  const maxRetries = 3;

  // Computed property for empty state
  const isEmpty = computed(() => notifications.value.length === 0);

  /**
   * Fetch notifications from the API
   */
  const fetchNotifications = async (
    page: number,
    group: string = '',
    category: string = '',
  ) => {
    if (isLoading.value || isLoadFailed.value) {
      return;
    }
    isLoading.value = true;

    try {
      // Construct the URL with only valid parameters
      let url = `/api/notifications?page=${page}&pageSize=10`;
      if (group && group !== 'all') url += `&group=${group}`;
      if (category && category !== 'all') url += `&category=${category}`;

      const response = await fetch(url);
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

  /**
   * Load more notifications (for pagination)
   */
  const loadMoreNotifications = (group: string = '', category: string = '') => {
    if (currentPage.value < totalPages.value) {
      fetchNotifications(currentPage.value + 1, group, category);
    }
  };

  /**
   * Retry fetching notifications after a failure
   */
  const retryFetchNotifications = (group: string = '', category: string = '') => {
    isLoadFailed.value = false;
    retryCount.value = 0;
    fetchNotifications(currentPage.value, group, category);
  };

  /**
   * Handle notification deletion
   */
  const handleNotificationDeleted = (deletedId: string) => {
    const index = notifications.value.findIndex((n) => n.id === deletedId);
    if (index !== -1) {
      notifications.value[index].isDeleting = true;
      setTimeout(() => {
        notifications.value = notifications.value.filter((n) => n.id !== deletedId);
      }, 500); // This should match the duration of your animation
    }
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
      const uiNotification = newNotification as UINotification;
      uiNotification.isNew = true;
      notifications.value.unshift(uiNotification);
      setTimeout(() => {
        const index = notifications.value.findIndex((n) => n.id === newNotification.id);
        if (index !== -1) {
          notifications.value[index].isNew = false;
        }
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
      notifications.value[index] = {
        ...notifications.value[index],
        ...updatedNotification,
        highlight: true // Highlight to show it was updated
      };

      // Remove highlight after a delay
      setTimeout(() => {
        const updatedIndex = notifications.value.findIndex((n) => n.id === updatedNotification.id);
        if (updatedIndex !== -1) {
          notifications.value[updatedIndex].highlight = false;
        }
      }, 3000);
    } else if (
      (currentGroup.value === 'all' || currentGroup.value === '' || updatedNotification.groupId === currentGroup.value) &&
      (currentCategory.value === 'all' || currentCategory.value === '' || updatedNotification.categoryId === currentCategory.value)
    ) {
      // Notification matches current filter but isn't in the list (could be pagination)
      // Consider refetching first page or handling differently
      const group = currentGroup.value === 'all' ? '' : currentGroup.value;
      const category = currentCategory.value === 'all' ? '' : currentCategory.value;
      fetchNotifications(1, group, category);
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
      notifications.value[index].highlight = true;

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
            notifications.value[updatedIndex].highlight = false;
          }
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
    isLoading,
    initialLoading,
    isLoadFailed,
    isEmpty,
    fetchNotifications,
    loadMoreNotifications,
    retryFetchNotifications,
    handleNotificationDeleted,
    handleNewNotification,
    handleUpdateNotification,
    fetchNotificationById,
    highlightNotification
  };
} 
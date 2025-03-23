import { ref } from 'vue';
import type { Notification } from '@/types/notification';

// Define interfaces for category and group
export interface Category {
  id: string;
  name: string;
  count?: number;
}

export interface Group {
  id: string;
  name: string;
  count?: number;
}

/**
 * Composable for managing notification filters (groups and categories)
 */
export function useNotificationFilters(
  initialGroup: string = '',
  initialCategory: string = ''
) {
  // Current filter state
  const currentGroup = ref(initialGroup);
  const currentCategory = ref(initialCategory);

  // Filter data
  const knownCategories = new Set<string>();
  const knownGroups = new Set<string>();

  /**
   * Initialize the known categories and groups from the provided arrays
   */
  const initializeKnownFilters = (
    categories: Array<{ id: string; name: string }>,
    groups: Array<{ id: string; name: string }>,
  ) => {
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
  };

  /**
   * Process new notification and check for new categories or groups
   */
  const processNewNotification = (notification: Notification) => {
    // Check if the notification has a new category
    if (notification.categoryId && !knownCategories.has(notification.categoryId)) {
      knownCategories.add(notification.categoryId);
      // Dispatch event for new category
      document.dispatchEvent(
        new CustomEvent('newNotificationCategory', {
          detail: {
            categoryId: notification.categoryId,
            groupId: notification.groupId
          },
        }),
      );
    }

    // Check if the notification has a new group
    if (notification.groupId && !knownGroups.has(notification.groupId)) {
      knownGroups.add(notification.groupId);
      // Dispatch event for new group
      document.dispatchEvent(
        new CustomEvent('newNotificationGroup', {
          detail: {
            groupId: notification.groupId,
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
  };

  /**
   * Switch to a notification's context (group and category)
   */
  const switchToNotificationContext = (
    notification: Notification,
    onFilterChange: (group: string, category: string) => void
  ) => {
    if (notification.groupId) {
      // Switch to the notification's group first
      currentGroup.value = notification.groupId;
      currentCategory.value = ''; // Reset category first

      // Then set category if it exists
      if (notification.categoryId) {
        setTimeout(() => {
          currentCategory.value = notification.categoryId || '';
        }, 100); // Small delay to ensure group change happens first
      }

      // Notify about the filter change
      onFilterChange(notification.groupId, notification.categoryId || '');
    }
  };

  /**
   * Change both filters at once
   */
  const changeFilters = (
    group: string,
    category: string,
    onFilterChange: (group: string, category: string) => void
  ) => {
    const effectiveGroup = group === 'all' ? '' : group;
    const effectiveCategory = category === 'all' ? '' : category;

    currentGroup.value = effectiveGroup;
    currentCategory.value = effectiveCategory;
    onFilterChange(effectiveGroup, effectiveCategory);
  };

  return {
    currentGroup,
    currentCategory,
    processNewNotification,
    switchToNotificationContext,
    changeFilters,
    initializeKnownFilters
  };
} 
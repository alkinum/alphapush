<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import DropdownMenu from '@/components/ui/dropdown-menu/DropdownMenu.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown-menu/DropdownMenuTrigger.vue';
import DropdownMenuContent from '@/components/ui/dropdown-menu/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown-menu/DropdownMenuItem.vue';
import { Button } from '@/components/ui/button';
import { ChevronDown } from '@lucide/vue';
import NotificationCategorySwitch from './NotificationCategorySwitch.vue';

interface Category {
  id: string;
  name: string;
  count?: number;
}

interface Group {
  id: string;
  name: string;
  count?: number;
}

// API response interfaces
interface ApiGroup {
  id: string;
  name: string;
  count: number | string;
}

interface ApiCategory {
  id: string;
  name: string;
  count: number | string;
}

interface GroupsResponse {
  groups: ApiGroup[];
}

interface CategoriesResponse {
  categoriesByGroup: Record<string, ApiCategory[]>;
}

interface Props {
  initialGroup?: string;
  initialCategory?: string;
  initialGroups?: Group[];
  initialCategories?: Category[];
  categoriesByGroup?: Record<string, Category[]>;
}

const props = withDefaults(defineProps<Props>(), {
  initialGroup: 'all',
  initialCategory: 'all',
  initialGroups: () => [],
  initialCategories: () => [],
  categoriesByGroup: () => ({ all: [] }),
});

console.log('NotificationGroupSwitch props:', props);

const emit = defineEmits<{
  (e: 'filterChange', group: string, category: string): void;
}>();

const currentGroup = ref(props.initialGroup);
const currentCategory = ref(props.initialCategory);

// Use initial data or default values
const groups = ref<Group[]>(props.initialGroups.length > 0 ? props.initialGroups : [{ id: 'all', name: 'All Groups' }]);

// Categories will be dynamically loaded based on selected group
const categories = ref<Category[]>(
  props.initialCategories.length > 0 ? props.initialCategories : [{ id: 'all', name: 'All' }],
);

// Get current group name for display
const currentGroupName = ref(groups.value.find((g) => g.id === currentGroup.value)?.name || 'All Groups');

// Store categories by group
const categoriesByGroup = ref<Record<string, Category[]>>(props.categoriesByGroup);

// Flag to track if data has been fetched
const dataFetched = ref(false);

// Fetch groups from API
const fetchGroups = async () => {
  try {
    const response = await fetch('/api/notification-groups');
    if (!response.ok) {
      console.error('Failed to fetch notification groups:', response.statusText);
      return;
    }

    const data = (await response.json()) as GroupsResponse;
    if (data.groups && Array.isArray(data.groups)) {
      // Ensure 'all' group is always available
      const hasAllGroup = data.groups.some((g) => g.id === 'all');
      if (!hasAllGroup) {
        data.groups.unshift({ id: 'all', name: 'All Groups', count: 0 });
      }

      // Map API response to our Group interface
      groups.value = data.groups.map((group) => ({
        id: group.id,
        name: group.name,
        count: typeof group.count === 'number' ? group.count : Number(group.count || 0),
      }));

      // Update current group name
      currentGroupName.value = groups.value.find((g) => g.id === currentGroup.value)?.name || 'All Groups';
    }
  } catch (error) {
    console.error('Error fetching notification groups:', error);
  }
};

// Fetch categories by group from API
const fetchCategoriesByGroup = async (groupId: string) => {
  try {
    // Set flag to indicate data is being fetched
    dataFetched.value = true;

    // Build the API URL with the group parameter
    const url = `/api/notification-categories${groupId !== 'all' ? `?group=${encodeURIComponent(groupId)}` : ''}`;

    const response = await fetch(url);
    if (!response.ok) {
      console.error('Failed to fetch notification categories:', response.statusText);
      return;
    }

    const data = (await response.json()) as CategoriesResponse;

    if (data.categoriesByGroup) {
      // Update our local categoriesByGroup ref
      if (groupId === 'all') {
        // If 'all' was requested, we get categories for all groups
        categoriesByGroup.value = {};

        // Process each group's categories
        for (const [groupKey, groupCategories] of Object.entries(data.categoriesByGroup)) {
          categoriesByGroup.value[groupKey] = groupCategories.map((category) => ({
            id: category.id,
            name: category.name,
            count: typeof category.count === 'number' ? category.count : Number(category.count || 0),
          }));
        }
      } else {
        // If a specific group was requested, we only get categories for that group
        const groupCategories = data.categoriesByGroup[groupId];
        if (groupCategories) {
          categoriesByGroup.value[groupId] = groupCategories.map((category) => ({
            id: category.id,
            name: category.name,
            count: typeof category.count === 'number' ? category.count : Number(category.count || 0),
          }));
        }
      }

      // Update the current categories based on the selected group
      if (categoriesByGroup.value[currentGroup.value]) {
        categories.value = categoriesByGroup.value[currentGroup.value];
      } else {
        // Fallback to 'all' if the current group doesn't have categories
        categories.value = categoriesByGroup.value['all'] || [{ id: 'all', name: 'All' }];
      }

      // Only reset category to 'all' if the current category doesn't exist in the new category list
      const categoryExists = categories.value.some((cat) => cat.id === currentCategory.value);
      if (!categoryExists) {
        currentCategory.value = 'all';
      }

      // Emit filter change event with updated values
      emit('filterChange', currentGroup.value, currentCategory.value);
    }
  } catch (error) {
    console.error('Error fetching notification categories:', error);
  }
};

// Filter categories based on selected group
const filterCategoriesByGroup = (groupId: string) => {
  // If we have categories for this group in our local state, use them
  if (categoriesByGroup.value[groupId]) {
    categories.value = categoriesByGroup.value[groupId];

    // Only reset category to 'all' if the current category doesn't exist in the new category list
    const categoryExists = categories.value.some((cat) => cat.id === currentCategory.value);
    if (!categoryExists) {
      currentCategory.value = 'all';
    }

    // Emit filter change event
    emit('filterChange', currentGroup.value, currentCategory.value);
  }
  // Otherwise, fetch from API if we're in the browser
  else if (typeof window !== 'undefined') {
    fetchCategoriesByGroup(groupId);
  }
};

const handleGroupChange = (value: string) => {
  if (currentGroup.value === value) return; // Avoid unnecessary re-renders

  currentGroup.value = value;
  // Update current group name
  currentGroupName.value = groups.value.find((g) => g.id === value)?.name || 'All Groups';

  // Filter categories based on the selected group
  filterCategoriesByGroup(value);
};

const handleCategoryChange = (value: string) => {
  if (currentCategory.value === value) return; // Avoid unnecessary re-renders

  currentCategory.value = value;
  emit('filterChange', currentGroup.value, value);
};

// Handle new notification category
const handleNewCategory = (event: CustomEvent) => {
  const { category, group } = event.detail;

  // If the category belongs to a specific group and it's not the current group,
  // we don't need to add it to the current view
  if (group && group !== currentGroup.value && currentGroup.value !== 'all') {
    return;
  }

  // Create the new category object
  const newCategory = {
    id: category,
    name: category,
  };

  // Add to the appropriate group in categoriesByGroup
  const targetGroup = group || 'all';
  if (!categoriesByGroup.value[targetGroup]) {
    categoriesByGroup.value[targetGroup] = [{ id: 'all', name: 'All' }];
  }

  // Check if this category already exists in the target group
  const existsInGroup = categoriesByGroup.value[targetGroup].some((c) => c.id === category);
  if (!existsInGroup) {
    categoriesByGroup.value[targetGroup].push(newCategory);
  }

  // If we're viewing the target group or 'all', update the categories list
  if (currentGroup.value === targetGroup || currentGroup.value === 'all') {
    // Check if this category already exists in the current view
    const existsInView = categories.value.some((c) => c.id === category);
    if (!existsInView) {
      categories.value.push(newCategory);
    }
  }

  // If we need to refresh data from the server, we can do that here
  // fetchCategoriesByGroup(currentGroup.value);
};

// Handle new notification group
const handleNewGroup = (event: CustomEvent) => {
  const { group } = event.detail;

  // Create the new group object
  const newGroup = {
    id: group,
    name: group,
  };

  // Check if this group already exists
  const exists = groups.value.some((g) => g.id === group);
  if (!exists) {
    groups.value.push(newGroup);
  }

  // Initialize categories for this group
  if (!categoriesByGroup.value[group]) {
    categoriesByGroup.value[group] = [{ id: 'all', name: 'All' }];
  }

  // If we need to refresh data from the server, we can do that here
  // fetchGroups();
};

// Watch for changes in the current group and update categories accordingly
watch(
  () => currentGroup.value,
  (newGroup) => {
    if (newGroup && !dataFetched.value) {
      filterCategoriesByGroup(newGroup);
    }
  },
);

onMounted(() => {
  // Only fetch data if we're in the browser and don't have initial data
  if (typeof window !== 'undefined') {
    if (groups.value.length <= 1 && groups.value[0]?.id === 'all') {
      fetchGroups();
    }

    if (
      !categoriesByGroup.value[currentGroup.value] ||
      (categoriesByGroup.value[currentGroup.value].length <= 1 &&
        categoriesByGroup.value[currentGroup.value][0]?.id === 'all')
    ) {
      fetchCategoriesByGroup(currentGroup.value);
    } else {
      // Use existing categories for the current group
      categories.value = categoriesByGroup.value[currentGroup.value];
    }

    // Listen for new notification category events
    document.addEventListener('newNotificationCategory', handleNewCategory as EventListener);
    document.addEventListener('newNotificationGroup', handleNewGroup as EventListener);
  }
});

onUnmounted(() => {
  // Clean up event listeners
  if (typeof window !== 'undefined') {
    document.removeEventListener('newNotificationCategory', handleNewCategory as EventListener);
    document.removeEventListener('newNotificationGroup', handleNewGroup as EventListener);
  }
});
</script>

<template>
  <div class="flex flex-col border rounded-lg space-y-4 mb-4 px-3 py-2">
    <div class="flex flex-col sm:flex-row sm:items-center gap-2">
      <div class="flex items-center">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button variant="outline" class="flex items-center gap-1">
              <span class="truncate max-w-[150px]">{{ currentGroupName }}</span>
              <ChevronDown class="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" class="w-[200px]">
            <DropdownMenuItem
              v-for="group in groups"
              :key="group.id"
              :class="{ 'bg-accent': currentGroup === group.id }"
              @click="handleGroupChange(group.id)"
            >
              <div class="flex justify-between items-center w-full">
                <span class="truncate">{{ group.name }}</span>
                <span v-if="group.count !== undefined" class="text-xs text-muted-foreground">{{ group.count }}</span>
              </div>
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <NotificationCategorySwitch
        :categories="categories"
        :currentCategory="currentCategory"
        @categoryChange="handleCategoryChange"
      />
    </div>
  </div>
</template>

<style scoped>
/* Hide scrollbar for Chrome, Safari and Opera */
.overflow-x-auto::-webkit-scrollbar {
  display: none;
}

/* Hide scrollbar for IE, Edge and Firefox */
.overflow-x-auto {
  -ms-overflow-style: none; /* IE and Edge */
  scrollbar-width: none; /* Firefox */
}
</style>

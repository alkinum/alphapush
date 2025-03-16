<script setup lang="ts">
import { ref, watch, onMounted, onUnmounted } from 'vue';
import DropdownMenu from '@/components/ui/dropdown-menu/DropdownMenu.vue';
import DropdownMenuTrigger from '@/components/ui/dropdown-menu/DropdownMenuTrigger.vue';
import DropdownMenuContent from '@/components/ui/dropdown-menu/DropdownMenuContent.vue';
import DropdownMenuItem from '@/components/ui/dropdown-menu/DropdownMenuItem.vue';
import { Button } from '@/components/ui/button';
import { ChevronDown } from 'lucide-vue-next';
import NotificationCategorySwitch from './NotificationCategorySwitch.vue';
import { formatName } from '@/utils/string';

interface Category {
  id: string;
  name: string;
}

interface Group {
  id: string;
  name: string;
}

interface FilterResponse {
  groups: Group[];
  categories: Category[];
}

interface Props {
  initialGroup?: string;
  initialCategory?: string;
  initialGroups?: Group[];
  initialCategories?: Category[];
}

const props = withDefaults(defineProps<Props>(), {
  initialGroup: 'all',
  initialCategory: 'all',
  initialGroups: () => [],
  initialCategories: () => [],
});

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

// Fetch filter data from API
const fetchFilters = async () => {
  try {
    const response = await fetch('/api/notification-filters');
    if (!response.ok) {
      console.error('Failed to fetch notification filters:', response.statusText);
      return;
    }

    const data = (await response.json()) as FilterResponse;

    // Update groups data
    if (data.groups && Array.isArray(data.groups)) {
      groups.value = data.groups;
      // Update current group name
      currentGroupName.value = groups.value.find((g) => g.id === currentGroup.value)?.name || 'All Groups';
    }

    // If category data exists, save for later use
    if (data.categories && Array.isArray(data.categories)) {
      // Filter categories based on current selected group
      filterCategoriesByGroup(currentGroup.value, data.categories);
    }
  } catch (error) {
    console.error('Error fetching notification filters:', error);
  }
};

// Filter categories based on selected group
const filterCategoriesByGroup = (groupId: string, allCategories?: Category[]) => {
  // If all categories are provided, use them; otherwise use default "All" category
  if (groupId === 'all') {
    categories.value = allCategories || [{ id: 'all', name: 'All' }];
  } else {
    // In a real application, we might need to filter by group
    // For now, simply return all categories
    categories.value = allCategories || [{ id: 'all', name: 'All' }];
  }

  // Reset category to 'all'
  currentCategory.value = 'all';

  // Emit filter change event
  emit('filterChange', currentGroup.value, currentCategory.value);
};

const handleGroupChange = (value: string) => {
  currentGroup.value = value;
  // Update current group name
  currentGroupName.value = groups.value.find((g) => g.id === value)?.name || 'All Groups';
  filterCategoriesByGroup(value);
};

const handleCategoryChange = (value: string) => {
  currentCategory.value = value;
  emit('filterChange', currentGroup.value, value);
};

// Handle new notification category
const handleNewCategory = (event: CustomEvent) => {
  const { category } = event.detail;

  // Check if this category already exists
  const exists = categories.value.some((c) => c.id === category);

  if (!exists) {
    // Add the new category
    categories.value.push({
      id: category,
      name: formatName(category),
    });

    console.debug(`Added new category: ${category}`);
  }
};

// Handle new notification group
const handleNewGroup = (event: CustomEvent) => {
  const { group } = event.detail;

  // Check if this group already exists
  const exists = groups.value.some((g) => g.id === group);

  if (!exists) {
    // Add the new group
    groups.value.push({
      id: group,
      name: formatName(group),
    });

    console.debug(`Added new group: ${group}`);
  }
};

onMounted(() => {
  // Fetch filter data in client-side rendering
  if (typeof window !== 'undefined') {
    fetchFilters();
  }

  // Load categories based on initial group
  filterCategoriesByGroup(currentGroup.value);

  // Add event listeners for new categories and groups
  document.addEventListener('newNotificationCategory', handleNewCategory as EventListener);
  document.addEventListener('newNotificationGroup', handleNewGroup as EventListener);
});

onUnmounted(() => {
  // Remove event listeners
  document.removeEventListener('newNotificationCategory', handleNewCategory as EventListener);
  document.removeEventListener('newNotificationGroup', handleNewGroup as EventListener);
});

watch(
  () => props.initialGroup,
  (newValue) => {
    if (newValue !== currentGroup.value) {
      currentGroup.value = newValue;
      // Update current group name
      currentGroupName.value = groups.value.find((g) => g.id === newValue)?.name || 'All Groups';
      filterCategoriesByGroup(newValue);
    }
  },
);

watch(
  () => props.initialCategory,
  (newValue) => {
    if (newValue !== currentCategory.value) {
      currentCategory.value = newValue;
    }
  },
);
</script>

<template>
  <div class="w-full bg-background border rounded-lg shadow-sm mb-4">
    <div class="flex flex-col sm:flex-row items-center p-2 px-4 gap-4">
      <div class="w-full sm:w-36">
        <DropdownMenu>
          <DropdownMenuTrigger as-child>
            <Button
              variant="outline"
              class="w-full justify-between bg-background text-primary border-input hover:bg-accent hover:text-accent-foreground"
            >
              <span class="truncate">{{ currentGroupName }}</span>
              <ChevronDown class="ml-2 h-4 w-4 opacity-70 flex-shrink-0" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent class="w-full min-w-36 bg-popover border-border text-popover-foreground">
            <DropdownMenuItem
              v-for="group in groups"
              :key="group.id"
              @click="handleGroupChange(group.id)"
              :class="{
                'bg-accent text-accent-foreground': currentGroup === group.id,
                'hover:bg-accent hover:text-accent-foreground': currentGroup !== group.id,
              }"
            >
              {{ group.name }}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div class="flex-1 w-full sm:w-auto overflow-x-auto">
        <NotificationCategorySwitch
          :categories="categories"
          :currentCategory="currentCategory"
          @categoryChange="handleCategoryChange"
        />
      </div>
    </div>
  </div>
</template>

<style lang="scss" scoped>
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

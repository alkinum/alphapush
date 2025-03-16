<template>
  <div class="flex space-x-6 overflow-x-auto">
    <button
      v-for="category in categories"
      :key="category.id"
      class="text-sm font-medium transition-colors focus:outline-none"
      :class="currentCategory === category.id ? 'text-primary' : 'text-muted-foreground hover:text-primary'"
      @click="handleCategoryClick(category.id)"
    >
      {{ category.name }}
    </button>
  </div>
</template>

<script setup lang="ts">
import { Button } from '@/components/ui/button';

interface Category {
  id: string;
  name: string;
}

interface Props {
  categories: Category[];
  currentCategory: string;
}

defineProps<Props>();

const emit = defineEmits<{
  (e: 'categoryChange', category: string): void;
}>();

const handleCategoryClick = (categoryId: string) => {
  emit('categoryChange', categoryId);
};
</script>

<style lnag="scss" scoped>
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

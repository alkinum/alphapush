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
      <span v-if="category.count !== undefined && category.count > 0" class="ml-1 text-xs text-muted-foreground">
        ({{ category.count }})
      </span>
    </button>
  </div>
</template>

<script setup lang="ts">
interface Category {
  id: string;
  name: string;
  count?: number;
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

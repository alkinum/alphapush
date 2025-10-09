<template>
  <div class="flex ml-1 space-x-6 overflow-x-auto flex-nowrap text-nowrap whitespace-nowrap">
    <button
      v-for="category in categories"
      :key="category.id"
      class="text-sm font-medium transition-colors focus:outline-none flex items-center gap-1.5"
      :class="currentCategory === category.id ? 'text-primary' : 'text-muted-foreground hover:text-primary'"
      @click="handleCategoryClick(category.id)"
    >
      <span>{{ category.name }}</span>
      <span
        v-if="category.count !== undefined && category.count > 0"
        class="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 text-[10px] font-semibold rounded-full transition-colors"
        :class="
          currentCategory === category.id
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-muted-foreground'
        "
      >
        {{ category.count }}
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

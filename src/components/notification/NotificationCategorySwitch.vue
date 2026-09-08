<template>
  <div
    class="category-switch flex min-w-0 flex-1 gap-0.5 overflow-x-auto whitespace-nowrap rounded-md bg-muted/50 p-0.5"
    role="tablist"
    aria-label="Notification category"
  >
    <button
      v-for="category in categories"
      :key="category.id"
      type="button"
      role="tab"
      :aria-selected="currentCategory === category.id"
      class="category-option relative flex h-7 shrink-0 items-center gap-1.5 rounded px-2.5 text-xs font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      :class="
        currentCategory === category.id
          ? 'active-category bg-background text-foreground shadow-sm'
          : 'text-muted-foreground hover:bg-background/50 hover:text-foreground'
      "
      @click="handleCategoryClick(category.id)"
    >
      <span>{{ category.name }}</span>
      <span
        v-if="category.count !== undefined && category.count > 0"
        class="inline-flex h-4 min-w-4 items-center justify-center rounded-sm px-1 text-[10px] font-semibold tabular-nums transition-colors"
        :class="
          currentCategory === category.id
            ? 'bg-secondary text-secondary-foreground'
            : 'bg-background text-muted-foreground'
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
.category-switch::-webkit-scrollbar {
  display: none;
}

.category-switch {
  -ms-overflow-style: none;
  scrollbar-width: none;
}

.category-option {
  transition:
    background-color 160ms ease,
    color 160ms ease,
    box-shadow 180ms ease,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.category-option:hover {
  transform: translateY(-1px);
}

.category-option:active {
  transform: scale(0.97);
}

.active-category {
  animation: category-activate 220ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

@keyframes category-activate {
  from {
    opacity: 0.7;
    transform: scale(0.96);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@media (prefers-reduced-motion: reduce) {
  .category-option,
  .active-category {
    animation: none;
    transition: none;
  }
}
</style>

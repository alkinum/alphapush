<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import { marked } from 'marked';
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Notification } from '@/types/notification';
import { highlighter } from '@/utils/highlighter';

interface Props {
  notification: Notification & { highlight?: boolean };
}

const props = defineProps<Props>();

const content = ref<HTMLElement | null>(null);
const isTruncated = ref(false);
const buttonText = ref('View All');

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const highlightedCode = highlighter.codeToHtml(text, {
    lang: lang || 'plaintext',
    theme: 'github-dark',
  });
  return `<div class="code-block">${highlightedCode}</div>`;
};

const renderedContent = marked(props.notification.content, { renderer });

const contentLength = computed(() => props.notification.content.length);
const isLikelyTruncated = computed(() => contentLength.value > 650);

const toggleContent = () => {
  if (content.value) {
    content.value.classList.toggle('max-h-[314px]');
    isTruncated.value = !isTruncated.value;
    buttonText.value = isTruncated.value ? 'View All' : 'Show Less';
  }
};

onMounted(() => {
  if (content.value && content.value.scrollHeight > content.value.clientHeight) {
    isTruncated.value = true;
  } else {
    isTruncated.value = false;
  }

  // Clear the query parameter
  if (props.notification.highlight) {
    const url = new URL(window.location.href);
    url.searchParams.delete('notificationId');
    url.searchParams.delete('category');
    url.searchParams.delete('group');
    window.history.replaceState({}, '', url);
  }
});
</script>

<template>
  <Card
    class="w-full mb-4 overflow-hidden notification-card"
    :class="{ 'highlight-effect': props.notification.highlight }"
  >
    <CardHeader class="pt-6 pb-2 px-6">
      <CardTitle>{{ notification.title }}</CardTitle>
    </CardHeader>
    <CardContent class="relative pt-2">
      <div
        ref="content"
        class="markdown-content"
        :class="{ 'max-h-[314px] overflow-hidden': isLikelyTruncated }"
        v-html="renderedContent"
      ></div>
      <div
        v-show="isLikelyTruncated"
        class="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-20% from-background to-transparent pointer-events-none fade-out"
      ></div>
      <Button
        v-show="isLikelyTruncated"
        variant="ghost"
        size="sm"
        class="absolute bottom-2 left-1/2 transform -translate-x-1/2 view-all-btn"
        @click="toggleContent"
      >
        {{ buttonText }}
      </Button>
    </CardContent>
  </Card>
</template>

<style scoped>
.markdown-content {
  font-family:
    system-ui,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    Roboto,
    Oxygen,
    Ubuntu,
    Cantarell,
    'Open Sans',
    'Helvetica Neue',
    sans-serif;
  line-height: 1.5;
  color: hsl(var(--foreground));
  padding-right: 16px;
  font-size: 0.875rem;
}

.markdown-content :deep(h1),
.markdown-content :deep(h2),
.markdown-content :deep(h3),
.markdown-content :deep(h4),
.markdown-content :deep(h5),
.markdown-content :deep(h6) {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.markdown-content :deep(h1) {
  font-size: 1.5rem;
}
.markdown-content :deep(h2) {
  font-size: 1.25rem;
}
.markdown-content :deep(h3) {
  font-size: 1.125rem;
}
.markdown-content :deep(h4) {
  font-size: 1rem;
}
.markdown-content :deep(h5) {
  font-size: 0.875rem;
}
.markdown-content :deep(h6) {
  font-size: 0.75rem;
}

.markdown-content :deep(p) {
  margin-bottom: 1em;
}

.markdown-content :deep(p:only-child) {
  margin-bottom: 0;
}

.markdown-content :deep(p:last-child) {
  margin-bottom: 0;
}

.markdown-content :deep(a) {
  color: hsl(var(--primary));
  text-decoration: none;
}

.markdown-content :deep(a:hover) {
  text-decoration: underline;
}

.markdown-content :deep(ul),
.markdown-content :deep(ol) {
  margin-bottom: 1em;
  padding-left: 2em;
}

.markdown-content :deep(li) {
  margin-bottom: 0.5em;
}

.markdown-content :deep(blockquote) {
  border-left: 4px solid hsl(var(--border));
  padding-left: 1em;
  color: hsl(var(--muted-foreground));
  margin-bottom: 1em;
}

.markdown-content :deep(.code-block) {
  margin-bottom: 1em;
  border-radius: 6px;
  overflow: hidden;
}

.markdown-content :deep(pre) {
  padding: 1em;
  overflow-x: auto;
}

.highlight-effect {
  animation: highlight 1.2s ease-in-out;
  animation-delay: 200ms;
}

@keyframes highlight {
  0%,
  100% {
    background-color: transparent;
  }
  40% {
    background-color: hsl(var(--primary) / 0.1);
  }
  60% {
    background-color: hsl(var(--primary) / 0.1);
  }
}
</style>

<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { useSwipe } from '@vueuse/core';
import { Icon } from '@iconify/vue';

import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Notification } from '@/types/notification';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useToast } from '@/components/ui/toast/use-toast';

import 'highlight.js/styles/github-dark.css';

interface Props {
  notification: Notification & { highlight?: boolean; isDeleting?: boolean; isNew?: boolean };
}

const props = defineProps<Props>();

const emit = defineEmits(['deleted']);

const { toast } = useToast();
const showDeleteDialog = ref(false);

const content = ref<HTMLElement | null>(null);
const isTruncated = ref(false);
const buttonText = ref('View All');
const isMobile = ref(false);
const isSwiped = ref(false);
const cardRef = ref<HTMLElement | null>(null);

const renderer = new marked.Renderer();
renderer.code = ({ text, language }) => {
  const highlightedCode = hljs.highlight(text, { language });
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

const handleDelete = async () => {
  try {
    const response = await fetch(`/api/notifications?id=${props.notification.id}`, {
      method: 'DELETE',
      credentials: 'include',
    });

    if (response.ok) {
      const result = (await response.json()) as { deletedId: string };
      toast({
        title: 'Notification deleted',
        description: 'The notification has been successfully deleted.',
      });
      emit('deleted', result.deletedId);
    } else {
      throw new Error('Failed to delete');
    }
  } catch (error) {
    console.error('Error deleting notification:', error);
    toast({
      title: 'Deletion failed',
      description: 'Unable to delete the notification. Please try again later.',
      variant: 'destructive',
    });
  } finally {
    showDeleteDialog.value = false;
  }
};

const handleSwipeReset = () => {
  isSwiped.value = false;
};

onMounted(() => {
  isMobile.value = /Android|webOS|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent);

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

  if (isMobile.value && cardRef.value) {
    const { direction } = useSwipe(cardRef, {
      threshold: 50,
      onSwipe() {
        if (direction.value === 'left') {
          isSwiped.value = true;
        } else if (direction.value === 'right') {
          isSwiped.value = false;
        }
      },
    });
  }
});
</script>

<template>
  <ContextMenu v-if="!isMobile">
    <ContextMenuTrigger>
      <Card
        ref="cardRef"
        class="w-full mb-4 overflow-hidden notification-card"
        :class="{
          'highlight-effect': props.notification.highlight,
          swiped: isSwiped,
          deleting: props.notification.isDeleting,
          'new-notification': props.notification.isNew,
        }"
        @click="handleSwipeReset"
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
    </ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem @select="showDeleteDialog = true">
        Delete
        <ContextMenuShortcut>
          <Icon icon="mdi:delete" class="w-4 h-4" />
        </ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>

  <div class="relative" v-else>
    <Card
      ref="cardRef"
      class="w-full mb-4 overflow-hidden notification-card"
      :class="{
        'highlight-effect': props.notification.highlight,
        swiped: isSwiped,
        deleting: props.notification.isDeleting,
        'new-notification': props.notification.isNew,
      }"
      @click="handleSwipeReset"
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

    <Button
      v-if="isMobile"
      variant="destructive"
      size="icon"
      class="absolute right-0 top-1/2 transform -translate-y-1/2 delete-btn"
      :class="{ 'fade-out': props.notification.isDeleting }"
      @click.stop="showDeleteDialog = true"
    >
      <Icon icon="mdi:delete" class="w-5 h-5" />
    </Button>
  </div>

  <Dialog v-model:open="showDeleteDialog">
    <DialogContent class="max-w-[95vw] sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Confirm Deletion</DialogTitle>
        <DialogDescription class="mt-4">
          Are you sure you want to delete this notification? This action cannot be undone.
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="sm:space-x-2 flex flex-col-reverse sm:flex-row sm:justify-end">
        <Button @click="showDeleteDialog = false" variant="outline" class="mt-2 sm:mt-0">Cancel</Button>
        <Button @click="handleDelete" variant="destructive">Delete</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
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

.notification-card {
  transition: transform 0.3s ease;
  position: relative;
  z-index: 1;
}

.notification-card.swiped {
  transform: translateX(-48px);
}

.delete-btn {
  z-index: 0;
  opacity: 0;
  transition: opacity 0.3s ease;
}

.notification-card.swiped + .delete-btn {
  opacity: 1;
}

.delete-btn.fade-out {
  transition: opacity 100ms ease;
  opacity: 0 !important;
}

.notification-card.deleting {
  transition:
    transform 0.5s ease,
    opacity 0.5s ease;
  transform: translateX(-100%);
  opacity: 0;
}

.notification-card.new-notification {
  animation: fly-in 0.5s ease-out;
}

@keyframes fly-in {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}
</style>

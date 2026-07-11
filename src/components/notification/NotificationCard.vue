<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from 'vue';
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import go from 'highlight.js/lib/languages/go';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import plaintext from 'highlight.js/lib/languages/plaintext';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import shell from 'highlight.js/lib/languages/shell';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';
import { marked } from 'marked';
import { useSwipe } from '@vueuse/core';
import { Icon } from '@iconify/vue';
import { decrypt } from '@alkinum/alphapush-encryption';
import { getMasterKey } from '@/utils/encryption';
import { userPreferenceManager } from '@/services/userPreferenceService';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import type { Notification } from '@/types/notification';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { useToast } from '@/components/ui/sonner/use-toast';
import { Skeleton } from '@/components/ui/skeleton';

import DeleteConfirmationDialog from './DeleteConfirmationDialog.vue';

import 'highlight.js/styles/github-dark.css';

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('diff', diff);
hljs.registerLanguage('go', go);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('plaintext', plaintext);
hljs.registerLanguage('python', python);
hljs.registerLanguage('rust', rust);
hljs.registerLanguage('shell', shell);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerAliases(['js', 'jsx'], { languageName: 'javascript' });
hljs.registerAliases(['ts', 'tsx'], { languageName: 'typescript' });
hljs.registerAliases(['sh', 'zsh'], { languageName: 'bash' });

interface Props {
  notification: Notification & { highlight?: boolean; isDeleting?: boolean; isNew?: boolean };
  selectionMode?: boolean;
  selected?: boolean;
  selectionEnabled?: boolean;
}

const props = withDefaults(defineProps<Props>(), {
  selectionMode: false,
  selected: false,
  selectionEnabled: false,
});

const emit = defineEmits<{
  (e: 'deleted', id: string): void;
  (e: 'selectionToggle', id: string): void;
  (e: 'selectionStart', id: string): void;
}>();

const { toast } = useToast();
const showDeleteDialog = ref(false);
const isLoading = ref(false);

const content = ref<HTMLElement | null>(null);
const isTruncated = ref(false);
const buttonText = ref('View All');
const isMobile = ref(false);
const isSwiped = ref(false);
const cardRef = ref<HTMLElement | null>(null);
const longPressTimer = ref<number | null>(null);
const longPressTriggered = ref(false);
const pointerStart = ref<{ x: number; y: number } | null>(null);

const renderer = new marked.Renderer();
renderer.code = ({ text, lang }) => {
  const language = lang && hljs.getLanguage(lang) ? lang : 'plaintext';
  const highlightedCode = hljs.highlight(text, { language, ignoreIllegals: true }).value;

  return `<pre class="code-block"><code class="hljs language-${language}">${highlightedCode}</code></pre>`;
};

const decryptedContent = ref<string | null>(null);
const decryptionError = ref<string | null>(null);

const LINE_HEIGHT = 24;
const MAX_LINES = 10;
const LONG_PRESS_DURATION_MS = 500;
const LONG_PRESS_MOVE_TOLERANCE = 8;

// Check if notification icons should be displayed
// Use a safe approach that works in both client and server environments
const showIcons = computed(() => {
  // During SSR, default to true
  if (typeof window === 'undefined') {
    return true;
  }

  // In browser, use the preference manager with default value true
  return userPreferenceManager.getPreference('showNotificationIcons', true);
});

// Compute a default title if none is provided
const displayTitle = computed(() => {
  if (props.notification.title) {
    return props.notification.title;
  }

  // Use category or group as fallback title
  if (props.notification.category) {
    return props.notification.category;
  }

  if (props.notification.notification_group) {
    return props.notification.notification_group;
  }

  // Default title if nothing else is available
  return 'Notification';
});

const hasSubtitle = computed(() => {
  return !!props.notification.subtitle;
});

const estimatedLineCount = computed(() => {
  if (props.notification.type !== 'encrypted') return 0;

  // Estimate the decrypted length (AES-GCM adds about 16 bytes of overhead)
  const estimatedDecryptedLength = Math.max(0, props.notification.content.length - 16);

  // Assume an average of 50 characters per line
  const averageCharsPerLine = 50;

  // Calculate estimated line count, with a minimum of 1 and maximum of MAX_LINES
  return Math.min(MAX_LINES, Math.max(1, Math.ceil(estimatedDecryptedLength / averageCharsPerLine)));
});

const skeletonLines = computed(() => {
  return Array.from({ length: estimatedLineCount.value }, (_, index) => ({
    width: index === estimatedLineCount.value - 1 ? '75%' : '100%',
  }));
});

const renderedContent = computed(() => {
  if (props.notification.type === 'encrypted') {
    if (decryptionError.value) {
      return `<p class="text-red-500">Decryption failed: ${decryptionError.value}</p>`;
    }
    if (decryptedContent.value === null) {
      return null; // Return null to indicate loading state
    }
    return marked(decryptedContent.value, { renderer });
  }
  return marked(props.notification.content, { renderer });
});

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

const isInteractiveTarget = (target: EventTarget | null) => {
  return target instanceof Element && !!target.closest('button, a, input, textarea, select, [role="button"]');
};

const clearLongPressTimer = () => {
  if (longPressTimer.value !== null) {
    window.clearTimeout(longPressTimer.value);
    longPressTimer.value = null;
  }
};

const startSelection = () => {
  if (!props.selectionEnabled || isMobile.value) {
    return;
  }

  longPressTriggered.value = true;
  emit('selectionStart', props.notification.id);
};

const handlePointerDown = (event: PointerEvent) => {
  if (
    !props.selectionEnabled ||
    props.selectionMode ||
    isMobile.value ||
    event.button !== 0 ||
    isInteractiveTarget(event.target)
  ) {
    return;
  }

  pointerStart.value = { x: event.clientX, y: event.clientY };
  clearLongPressTimer();
  longPressTimer.value = window.setTimeout(startSelection, LONG_PRESS_DURATION_MS);
};

const handlePointerMove = (event: PointerEvent) => {
  if (!pointerStart.value || longPressTimer.value === null) {
    return;
  }

  const distanceX = Math.abs(event.clientX - pointerStart.value.x);
  const distanceY = Math.abs(event.clientY - pointerStart.value.y);

  if (distanceX > LONG_PRESS_MOVE_TOLERANCE || distanceY > LONG_PRESS_MOVE_TOLERANCE) {
    clearLongPressTimer();
  }
};

const handlePointerEnd = () => {
  clearLongPressTimer();
  pointerStart.value = null;
};

const handleCardClick = (event: MouseEvent) => {
  if (longPressTriggered.value) {
    event.preventDefault();
    longPressTriggered.value = false;
    return;
  }

  if (props.selectionMode && !isMobile.value && !isInteractiveTarget(event.target)) {
    emit('selectionToggle', props.notification.id);
    return;
  }

  handleSwipeReset();
};

const handleSelectionCheckboxChange = () => {
  emit('selectionToggle', props.notification.id);
};

const handleSelectFromContextMenu = () => {
  if (!props.selectionEnabled) {
    return;
  }

  if (props.selectionMode) {
    emit('selectionToggle', props.notification.id);
    return;
  }

  emit('selectionStart', props.notification.id);
};

const isApprovalProcess = computed(() => props.notification.type === 'approval-process');
const approvalState = ref(props.notification.approvalState);

const showApprovalButtons = computed(() => isApprovalProcess.value && approvalState.value === 'pending');
const isUnread = computed(() => !props.notification.readAt);
const handleApprove = async () => {
  await updateApprovalState('approved');
};

const handleReject = async () => {
  await updateApprovalState('rejected');
};

const updateApprovalState = async (state: 'approved' | 'rejected') => {
  try {
    const response = await fetch('/api/approval', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        approvalId: props.notification.approvalId,
        state,
      }),
    });

    if (response.ok) {
      approvalState.value = state;
    } else {
      const errorResponse: { error?: string } = await response.json();
      throw new Error(errorResponse.error || 'Failed to update approval state');
    }
  } catch (error: unknown) {
    console.error('Error updating approval state:', error);
    toast({
      title: 'Error',
      description: `Failed to update approval state: ${error instanceof Error ? error.message : 'Unknown error'}`,
      variant: 'destructive',
    });
  }
};

onMounted(async () => {
  // Only run client-side code in the browser
  if (typeof window !== 'undefined') {
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
      url.searchParams.delete('notification_group');
      url.searchParams.delete('attemptId');
      url.searchParams.delete('receiptToken');
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
        onSwipeEnd() {
          if (direction.value === 'left') {
            isSwiped.value = true;
          }
        },
      });
    }

    // Check for approvalId and action in query parameters
    const urlParams = new URLSearchParams(window.location.search);
    const approvalId = urlParams.get('approvalId');
    const action = urlParams.get('action')?.toLowerCase();

    try {
      if (approvalId === props.notification.approvalId && (action === 'approve' || action === 'reject')) {
        await updateApprovalState(action === 'approve' ? 'approved' : 'rejected');
      }
    } catch (error) {
      console.error('Error processing approval action:', error);
    } finally {
      // Remove approvalId and action from query parameters
      const url = new URL(window.location.href);
      url.searchParams.delete('approvalId');
      url.searchParams.delete('action');
      window.history.replaceState({}, '', url);
    }

    if (props.notification.type === 'encrypted') {
      try {
        const masterKey = await getMasterKey();
        if (!masterKey) {
          throw new Error('Master key not found');
        }
        const extraInfo = props.notification.extraInfo ? JSON.parse(props.notification.extraInfo) : {};
        const nonce = extraInfo.nonce;
        if (!nonce) {
          throw new Error('Nonce not found in extra info');
        }
        const decrypted = await decrypt(props.notification.content, masterKey, nonce);
        decryptedContent.value = decrypted;
      } catch (error) {
        console.error('Decryption failed:', error);
        decryptionError.value = 'Unable to decrypt content. Please check your encryption key or notification data.';
      }
    }
  }
});

onUnmounted(() => {
  clearLongPressTimer();
});

const handleCancelDelete = () => {
  showDeleteDialog.value = false;
};
</script>

<template>
  <div v-if="isLoading" class="w-full mb-4">
    <Card>
      <CardHeader class="pt-6 pb-2 px-6">
        <div class="flex items-center gap-3">
          <div class="flex-shrink-0">
            <Skeleton class="w-6 h-6 rounded-sm" />
          </div>
          <div class="flex-grow">
            <Skeleton class="h-5 w-32" />
            <Skeleton v-if="Math.random() > 0.5" class="h-4 w-24 mt-1" />
          </div>
        </div>
      </CardHeader>
      <CardContent class="px-6 py-4">
        <div class="space-y-2">
          <Skeleton v-for="(line, index) in skeletonLines" :key="index" class="h-4" :class="line.width" />
        </div>
      </CardContent>
    </Card>
  </div>
  <ContextMenu v-else>
    <ContextMenuTrigger as-child :disabled="isMobile">
      <div class="relative">
        <div
          ref="cardRef"
          :id="`notification-${props.notification.id}`"
          class="w-full mb-4 overflow-hidden notification-card"
          :class="{
            'highlight-effect': props.notification.highlight,
            swiped: isSwiped,
            deleting: props.notification.isDeleting,
            'new-notification': props.notification.isNew,
            'unread-notification': isUnread,
            selected: props.selected,
            'selection-mode': props.selectionMode,
          }"
          @click="handleCardClick"
          @pointerdown="handlePointerDown"
          @pointermove="handlePointerMove"
          @pointerup="handlePointerEnd"
          @pointerleave="handlePointerEnd"
          @pointercancel="handlePointerEnd"
        >
      <Card>
        <CardHeader class="pt-6 pb-2 px-6">
          <div class="flex items-center gap-3">
            <div v-if="props.selectionMode && !isMobile" class="flex-shrink-0" @click.stop>
              <Checkbox
                :checked="props.selected"
                aria-label="Select notification"
                @update:checked="handleSelectionCheckboxChange"
              />
            </div>
            <div v-if="showIcons && props.notification.iconUrl" class="flex-shrink-0">
              <img
                :src="props.notification.iconUrl"
                alt="Notification icon"
                class="w-6 h-6 object-contain rounded-sm"
                onerror="this.style.display='none'"
              />
            </div>
            <div class="flex-grow">
              <div class="flex items-center gap-2">
                <span
                  v-if="isUnread"
                  class="h-2 w-2 flex-shrink-0 rounded-full bg-primary"
                  aria-label="Unread notification"
                ></span>
                <CardTitle>{{ displayTitle }}</CardTitle>
              </div>
              <p v-if="hasSubtitle" class="text-sm text-muted-foreground mt-1">
                {{ props.notification.subtitle }}
              </p>
            </div>
          </div>
        </CardHeader>
        <CardContent class="relative pt-2 pb-4">
          <template v-if="renderedContent === null && props.notification.type === 'encrypted'">
            <div class="space-y-1">
              <Skeleton
                v-for="(line, index) in skeletonLines"
                :key="index"
                :style="{ height: `${LINE_HEIGHT}px` }"
                :class="[`w-[${line.width}]`]"
              />
            </div>
          </template>
          <div
            v-else
            ref="content"
            class="markdown-content"
            :class="{ 'max-h-[314px] overflow-hidden': isLikelyTruncated && !isApprovalProcess }"
            v-html="renderedContent"
          ></div>
          <div
            v-if="isLikelyTruncated && !isApprovalProcess"
            class="absolute bottom-0 left-0 right-0 h-36 bg-gradient-to-t from-20% from-background to-transparent pointer-events-none fade-out"
          ></div>
          <Button
            v-if="isLikelyTruncated && !isApprovalProcess"
            variant="ghost"
            size="sm"
            class="absolute bottom-2 left-1/2 transform -translate-x-1/2 view-all-btn"
            @click.stop="toggleContent"
          >
            {{ buttonText }}
          </Button>
        </CardContent>
        <CardFooter v-if="isApprovalProcess" class="px-6 py-4 border-t">
          <div v-if="showApprovalButtons" class="flex justify-end w-full gap-4">
            <Button @click="handleReject" variant="destructive" class="flex-1">Reject</Button>
            <Button @click="handleApprove" variant="secondary" class="flex-1">Approve</Button>
          </div>
          <div v-else class="flex justify-end items-center w-full">
            <Button size="sm" disabled class="w-full">
              {{ approvalState ? approvalState.charAt(0).toUpperCase() + approvalState.slice(1) : 'Unknown State' }}
            </Button>
          </div>
        </CardFooter>
      </Card>
        </div>

    <Button
      v-if="isMobile"
      variant="destructive"
      size="icon"
      aria-label="Delete notification"
      class="absolute right-0 top-1/2 transform -translate-y-1/2 delete-btn"
      :style="{ opacity: isSwiped ? 1 : 0, pointerEvents: isSwiped ? 'auto' : 'none' }"
      :class="{ 'fade-out': props.notification.isDeleting }"
      @click.stop="showDeleteDialog = true"
    >
      <Icon icon="mdi:delete" class="w-5 h-5" />
    </Button>
      </div>
    </ContextMenuTrigger>
    <ContextMenuContent v-if="!isMobile">
      <ContextMenuItem v-if="props.selectionEnabled" @select="handleSelectFromContextMenu">
        {{ props.selected ? 'Deselect' : 'Select' }}
        <ContextMenuShortcut>
          <Icon :icon="props.selected ? 'mdi:checkbox-blank-outline' : 'mdi:checkbox-marked-outline'" class="w-4 h-4" />
        </ContextMenuShortcut>
      </ContextMenuItem>
      <ContextMenuItem @select="showDeleteDialog = true">
        Delete
        <ContextMenuShortcut>
          <Icon icon="mdi:delete" class="w-4 h-4" />
        </ContextMenuShortcut>
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>

  <DeleteConfirmationDialog
    v-if="showDeleteDialog"
    :isOpen="showDeleteDialog"
    @confirm="handleDelete"
    @cancel="showDeleteDialog = false"
    @update:isOpen="(value) => (showDeleteDialog = value)"
  />
</template>

<style>
@reference "../../styles/globals.css";

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

.markdown-content h1,
.markdown-content h2,
.markdown-content h3,
.markdown-content h4,
.markdown-content h5,
.markdown-content h6 {
  margin-top: 1.5em;
  margin-bottom: 0.5em;
  font-weight: 600;
}

.markdown-content h1 {
  font-size: 1.5rem;
}
.markdown-content h2 {
  font-size: 1.25rem;
}
.markdown-content h3 {
  font-size: 1.125rem;
}
.markdown-content h4 {
  font-size: 1rem;
}
.markdown-content h5 {
  font-size: 0.875rem;
}
.markdown-content h6 {
  font-size: 0.75rem;
}

.markdown-content p {
  margin-bottom: 24px;
}

.markdown-content p:only-child {
  margin-bottom: 0;
}

.markdown-content p:last-child {
  margin-bottom: 0;
}

.markdown-content a {
  color: hsl(var(--primary));
  text-decoration: none;
}

.markdown-content a:hover {
  text-decoration: underline;
}

.markdown-content ul,
.markdown-content ol {
  margin-bottom: 1em;
  padding-left: 2em;
}

.markdown-content li {
  margin-bottom: 0.5em;
}

.markdown-content blockquote {
  border-left: 4px solid hsl(var(--border));
  padding-left: 1em;
  color: hsl(var(--muted-foreground));
  margin-bottom: 1em;
}

.markdown-content .code-block {
  margin-bottom: 1em;
  border-radius: 6px;
  overflow: hidden;
}

.highlight-effect {
  animation: highlight-pulse 3s ease-in-out;
}

@keyframes highlight-pulse {
  0%,
  100% {
    box-shadow: 0 0 0 0 rgba(var(--primary), 0);
  }
  20% {
    box-shadow: 0 0 0 8px rgba(var(--primary), 0.3);
  }
  40% {
    box-shadow: 0 0 0 4px rgba(var(--primary), 0.2);
  }
  60% {
    box-shadow: 0 0 0 8px rgba(var(--primary), 0.3);
  }
  80% {
    box-shadow: 0 0 0 4px rgba(var(--primary), 0.2);
  }
}

.notification-card {
  transition: transform 0.3s ease;
  position: relative;
  z-index: 1;
}

.notification-card.selection-mode {
  cursor: pointer;
}

.notification-card.selected .border {
  border-color: hsl(var(--primary));
  box-shadow: 0 0 0 1px hsl(var(--primary) / 0.4);
}

.notification-card.swiped {
  transform: translateX(-48px);
}

.notification-card.swiped ~ .delete-btn {
  opacity: 1;
  pointer-events: auto;
}

.delete-btn {
  z-index: 0;
  opacity: 0;
  transition: opacity 0.3s ease;
  pointer-events: none;
}

.delete-btn.visible {
  opacity: 1;
}

.delete-btn.fade-out {
  transition: opacity 100ms ease;
  opacity: 0 !important;
}

.notification-card.deleting {
  animation: slide-out 0.5s ease-in;
}

@keyframes slide-out {
  from {
    transform: translateX(0);
    opacity: 1;
  }
  to {
    transform: translateX(-100%);
    opacity: 0;
  }
}

.notification-card.new-notification {
  animation: slide-in 0.5s ease-out;
}

.notification-card.unread-notification .border {
  border-color: hsl(var(--primary) / 0.5);
}

@keyframes slide-in {
  from {
    transform: translateX(100%);
    opacity: 0;
  }
  to {
    transform: translateX(0);
    opacity: 1;
  }
}

.notification-card .border-t {
  border-top: 1px solid hsl(var(--border));
}

.markdown-content .skeleton {
  @apply bg-muted;
}
</style>

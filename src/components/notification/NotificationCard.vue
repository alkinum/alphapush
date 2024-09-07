<script setup lang="ts">
import { ref, onMounted, computed } from 'vue';
import hljs from 'highlight.js';
import { marked } from 'marked';
import { useSwipe } from '@vueuse/core';
import { Icon } from '@iconify/vue';
import { decrypt } from '@alkinum/alphapush-encryption';
import { getMasterKey } from '@/utils/encryption';

import { Card, CardHeader, CardTitle, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import type { Notification } from '@/types/notification';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuTrigger,
  ContextMenuShortcut,
} from '@/components/ui/context-menu';
import { useToast } from '@/components/ui/toast/use-toast';

import DeleteConfirmationDialog from './DeleteConfirmationDialog.vue';

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
renderer.code = ({ text, lang }) => {
  const highlightedCode = hljs.highlight(text, { language: lang || 'text' });
  return `<div class="code-block">${highlightedCode}</div>`;
};

const decryptedContent = ref<string | null>(null);
const decryptionError = ref<string | null>(null);

const renderedContent = computed(() => {
  if (props.notification.type === 'encrypted') {
    if (decryptionError.value) {
      return `<p class="text-red-500">Decryption failed: ${decryptionError.value}</p>`;
    }
    if (decryptedContent.value === null) {
      return '<p>Decrypting content...</p>';
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

const isApprovalProcess = computed(() => props.notification.type === 'approval-process');
const approvalState = ref(props.notification.approvalState);

const showApprovalButtons = computed(() => isApprovalProcess.value && approvalState.value === 'pending');

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
  } catch (error: any) {
    console.error('Error updating approval state:', error);
    toast({
      title: 'Error',
      description: `Failed to update approval state: ${error.message}`,
      variant: 'destructive',
    });
  }
};

onMounted(async () => {
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
});

const handleCancelDelete = () => {
  showDeleteDialog.value = false;
};
</script>

<template>
  <div>
    <ContextMenu v-if="!isMobile">
      <ContextMenuTrigger>
        <div
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
          <Card>
            <CardHeader class="pt-6 pb-2 px-6">
              <CardTitle>{{ notification.title }}</CardTitle>
            </CardHeader>
            <CardContent class="relative pt-2 pb-4">
              <div
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
                @click="toggleContent"
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
      <div
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
        <Card>
          <CardHeader class="pt-6 pb-2 px-6">
            <CardTitle>{{ notification.title }}</CardTitle>
          </CardHeader>
          <CardContent class="relative pt-2 pb-4">
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
        class="absolute right-0 top-1/2 transform -translate-y-1/2 delete-btn"
        :class="{ 'fade-out': props.notification.isDeleting }"
        @click.stop="showDeleteDialog = true"
      >
        <Icon icon="mdi:delete" class="w-5 h-5" />
      </Button>
    </div>

    <DeleteConfirmationDialog v-model:isOpen="showDeleteDialog" @confirm="handleDelete" @cancel="handleCancelDelete" />
  </div>
</template>

<style module>
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

.notification-card :deep(.border-t) {
  border-top: 1px solid hsl(var(--border));
}
</style>

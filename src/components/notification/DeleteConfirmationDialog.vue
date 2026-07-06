<script setup lang="ts">
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';

interface Props {
  isOpen: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  title?: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

withDefaults(defineProps<Props>(), {
  title: 'Confirm Deletion',
  description: 'Are you sure you want to delete this notification? This action cannot be undone.',
  confirmLabel: 'Delete',
  cancelLabel: 'Cancel',
});
defineEmits<{
  (e: 'update:isOpen', value: boolean): void;
}>();
</script>

<template>
  <Dialog :open="isOpen" @update:open="$emit('update:isOpen', $event)">
    <DialogContent class="max-w-[95vw] sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{ title }}</DialogTitle>
        <DialogDescription class="mt-4">
          {{ description }}
        </DialogDescription>
      </DialogHeader>
      <DialogFooter class="sm:space-x-2 flex flex-col-reverse sm:flex-row sm:justify-end">
        <Button @click="onCancel" variant="outline" class="mt-2 sm:mt-0">{{ cancelLabel }}</Button>
        <Button @click="onConfirm" variant="destructive">{{ confirmLabel }}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

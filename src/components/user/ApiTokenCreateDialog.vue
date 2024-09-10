<script setup lang="ts">
import { defineEmits, defineProps } from 'vue';
import * as z from 'zod';
import { useForm } from 'vee-validate';
import { toTypedSchema } from '@vee-validate/zod';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { useToast } from '@/components/ui/toast';

defineProps({
  open: {
    type: Boolean,
    required: true,
  },
});

const emit = defineEmits<{
  (e: 'update:open', value: boolean): void;
  (e: 'tokenCreated'): void;
}>();

const { toast } = useToast();

const zodSchema = z.object({
  name: z.string().min(1, 'Token name is required'),
  expiresIn: z
    .number()
    .int()
    .min(1, 'Expiry must be at least 1 day')
    .max(365, 'Expiry cannot exceed 365 days')
    .optional(),
  isPermanent: z.boolean(),
});

type FormValues = z.infer<typeof zodSchema>;

const formSchema = toTypedSchema(zodSchema);

const form = useForm<FormValues>({
  validationSchema: formSchema,
  initialValues: {
    name: '',
    expiresIn: 30,
    isPermanent: false,
  },
});

const resetForm = () => {
  form.resetForm();
};

const onSubmit = form.handleSubmit(async (values) => {
  try {
    const response = await fetch('/api/api-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        expiresIn: values.isPermanent ? 0 : values.expiresIn,
      }),
    });
    if (response.ok) {
      await response.json();
      toast({
        title: 'Success',
        description: 'New API token has been created',
      });
      emit('tokenCreated');
      emit('update:open', false);
      resetForm();
    } else {
      throw new Error('Failed to create token');
    }
  } catch (error) {
    console.error('Error creating token:', error);
    toast({
      title: 'Error',
      description: 'Failed to create API token',
      variant: 'destructive',
    });
  }
});

const closeDialog = () => {
  emit('update:open', false);
  resetForm();
};

defineExpose({ open });
</script>

<template>
  <Dialog :open="open" @update:open="(val) => emit('update:open', val)">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>Create New API Token</DialogTitle>
        <DialogDescription>
          Create a new token for API access. Make sure to store the generated token securely.
        </DialogDescription>
      </DialogHeader>
      <form @submit="onSubmit" class="space-y-8">
        <FormField v-slot="{ componentField }" name="name">
          <FormItem>
            <FormLabel>Name</FormLabel>
            <FormControl>
              <Input v-bind="componentField" placeholder="Enter token name" />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
        <FormField v-if="!form.values.isPermanent" v-slot="{ field }" name="expiresIn">
          <FormItem>
            <FormLabel>Expiry (days)</FormLabel>
            <FormControl>
              <Input v-bind="field" type="number" placeholder="Enter expiry in days" />
            </FormControl>
            <FormMessage />
          </FormItem>
        </FormField>
        <FormField v-slot="{ field }" name="isPermanent">
          <FormItem class="flex flex-row items-center justify-between rounded-lg border p-3">
            <div class="space-y-0.5">
              <FormLabel class="text-sm">Permanent Token</FormLabel>
            </div>
            <FormControl>
              <Switch
                :checked="field.value"
                @update:checked="field.onChange"
              />
            </FormControl>
          </FormItem>
        </FormField>
        <DialogFooter>
          <Button type="button" variant="outline" @click="closeDialog">Cancel</Button>
          <Button type="submit">Create Token</Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

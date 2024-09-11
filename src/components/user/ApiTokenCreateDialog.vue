<script setup lang="ts">
import { defineEmits, defineProps, ref } from 'vue';
import * as z from 'zod';
import { useForm } from 'vee-validate';

import { Icon } from '@iconify/vue';
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
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card';
import { FormControl, FormField, FormItem, FormLabel, FormMessage } from '@/components/ui/form';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';

const expiryOptions = [
  { value: 1, label: '1 day' },
  { value: 3, label: '3 days' },
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 60, label: '60 days' },
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '1 year' },
  { value: 730, label: '2 years' },
  { value: 1095, label: '3 years' },
  { value: 1825, label: '5 years' },
  { value: 0, label: 'Permanent' },
];

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

// Define the API response interface
interface CreateApiTokenResponse {
  token: string;
}

const zodSchema = z.object({
  name: z.string().min(1, 'Token name is required'),
  expiresIn: z.number().int().min(0).max(1825),
});

type FormValues = z.infer<typeof zodSchema>;

const formSchema = toTypedSchema(zodSchema);

const form = useForm<FormValues>({
  validationSchema: formSchema,
  initialValues: {
    name: '',
    expiresIn: 30,
  },
});

const resetForm = () => {
  form.resetForm();
};

const createdToken = ref<string | null>(null);

const onSubmit = form.handleSubmit(async (values: FormValues) => {
  try {
    const response = await fetch('/api/api-token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: values.name,
        expiresIn: values.expiresIn,
      }),
    });
    if (response.ok) {
      const data: CreateApiTokenResponse = await response.json();
      createdToken.value = data.token;
      toast({
        title: 'Success',
        description: 'New API token has been created',
      });
      emit('tokenCreated');
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

const handleSubmit = () => {
  onSubmit();
};

const handleDialogUpdate = (val: boolean) => {
  emit('update:open', val);
  if (!val) {
    closeDialog();
  }
};

const closeDialog = () => {
  emit('update:open', false);
  resetForm();
  createdToken.value = null; // Reset the created token when closing
};

const copyToken = () => {
  if (!createdToken.value) {
    return;
  }
  navigator.clipboard.writeText(createdToken.value).then(() => {
    toast({
      title: 'Copied',
      description: 'API token copied to clipboard',
    });
  });
};

const handleExpiryChange = (value: string) => {
  form.setFieldValue('expiresIn', Number(value));
};

defineExpose({ open });
</script>

<template>
  <Dialog :open="open" @update:open="handleDialogUpdate">
    <DialogContent class="sm:max-w-[425px]">
      <DialogHeader>
        <DialogTitle>{{ createdToken ? 'API Token Created' : 'Create New API Token' }}</DialogTitle>
      </DialogHeader>
      <DialogDescription>
        {{
          createdToken
            ? 'Your new API token has been created. Please copy and store it securely.'
            : 'Create a new token for API access. Make sure to store the generated token securely.'
        }}
      </DialogDescription>
      <form @submit="onSubmit" v-show="!createdToken">
        <div class="space-y-4">
          <FormField v-slot="{ componentField }" name="name">
            <FormItem>
              <FormLabel>Name</FormLabel>
              <FormControl>
                <Input v-bind="componentField" placeholder="Enter token name" />
              </FormControl>
              <FormMessage />
            </FormItem>
          </FormField>
          <FormField v-slot="{ field }" name="expiresIn">
            <FormItem>
              <FormLabel>Expiry</FormLabel>
              <Select :model-value="String(field.value)" @update:model-value="(value) => handleExpiryChange(value)">
                <FormControl>
                  <SelectTrigger>
                    <SelectValue
                      :placeholder="
                        field.value ? expiryOptions.find((o) => o.value === field.value)?.label : 'Select expiry time'
                      "
                    />
                  </SelectTrigger>
                </FormControl>
                <SelectContent>
                  <SelectItem v-for="option in expiryOptions" :key="option.value" :value="String(option.value)">
                    {{ option.label }}
                  </SelectItem>
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          </FormField>
        </div>
      </form>
      <div v-show="createdToken" class="space-y-4">
        <Card>
          <CardHeader class="pb-2">
            <CardTitle>Your New API Token</CardTitle>
          </CardHeader>
          <CardContent class="pt-2 px-6 pb-6">
            <div class="flex items-center space-x-2">
              <p class="text-sm font-mono break-all bg-muted p-2 rounded-lg flex-grow">{{ createdToken }}</p>
              <Button class="flex-shrink-0" @click="copyToken" variant="outline" size="icon">
                <Icon icon="mdi:content-copy" class="h-4 w-4" />
              </Button>
            </div>
          </CardContent>
        </Card>
        <p class="text-sm text-yellow-600 dark:text-yellow-400">
          Warning: This token will never be shown again. Please copy it and store it in a secure location.
        </p>
      </div>
      <DialogFooter class="mt-6">
        <template v-if="!createdToken">
          <Button type="button" variant="outline" @click="closeDialog">Cancel</Button>
          <Button type="button" @click="handleSubmit">Create Token</Button>
        </template>
        <Button v-else type="button" @click="closeDialog">Close</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted } from 'vue';
import { useToast } from '@/components/ui/toast/use-toast';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';

interface Session {
  user?: {
    email?: string;
    name?: string;
  };
}

interface Props {
  session: Session | null;
  initialPushToken: string | null;
}

interface NotificationResponse {
  success: boolean;
  notificationId?: string;
  approvalId?: string;
  error?: string;
  failedPushes?: Array<any>;
}

interface PushPayload {
  pushToken: string;
  content: string;
  title?: string;
  subtitle?: string;
  category?: string;
  group?: string;
  icon_url?: string;
  type?: string;
  webhook_url?: string;
  topic?: string;
  navigate_url?: string;
  extra?: Record<string, any>;
}

const props = defineProps<Props>();
const { toast } = useToast();

// Form state
const pushToken = ref(props.initialPushToken || '');
const title = ref('');
const body = ref('');
const group = ref('');
const category = ref('');
const url = ref('');
const icon = ref('');
const isSubmitting = ref(false);
const preserveInputs = ref(true); // Default to true for preserving inputs

// Handle new push token event
const handleNewPushToken = (event: CustomEvent) => {
  const { pushToken: newPushToken } = event.detail;
  if (newPushToken) {
    pushToken.value = newPushToken;
  }
};

// Setup event listeners
onMounted(() => {
  document.addEventListener('newPushToken', handleNewPushToken as EventListener);
});

onUnmounted(() => {
  document.removeEventListener('newPushToken', handleNewPushToken as EventListener);
});

// Clear form function
function clearForm() {
  title.value = '';
  body.value = '';
  group.value = '';
  category.value = '';
  url.value = '';
  icon.value = '';

  toast({
    title: 'Form Cleared',
    description: 'All input fields have been cleared',
  });
}

// Send notification
async function sendNotification() {
  if (!pushToken.value) {
    toast({
      title: 'Error',
      description: 'Push token is required',
      variant: 'destructive',
    });
    return;
  }

  if (!body.value) {
    toast({
      title: 'Error',
      description: 'Notification body is required',
      variant: 'destructive',
    });
    return;
  }

  isSubmitting.value = true;

  try {
    // Build the payload for the /api/push endpoint
    const payload: PushPayload = {
      pushToken: pushToken.value,
      content: body.value,
    };

    // Add optional fields if they exist
    if (title.value) {
      payload.title = title.value;
    }

    if (group.value) {
      payload.group = group.value;
    }

    if (category.value) {
      payload.category = category.value;
    }

    if (url.value) {
      payload.navigate_url = url.value;
    }

    if (icon.value) {
      payload.icon_url = icon.value;
    }

    // Send the notification using the proper API endpoint
    const response = await fetch('/api/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const result = (await response.json()) as NotificationResponse;

    if (response.ok && result.success) {
      toast({
        title: 'Success',
        description: `Notification sent successfully (ID: ${result.notificationId})`,
      });

      // Clear form fields if preserve inputs is not checked
      if (!preserveInputs.value) {
        title.value = '';
        body.value = '';
        category.value = '';
        group.value = '';
        url.value = '';
        icon.value = '';
      }
    } else {
      toast({
        title: 'Error',
        description: result.error || 'Failed to send notification',
        variant: 'destructive',
      });
    }
  } catch (error) {
    console.error('Error sending notification:', error);
    toast({
      title: 'Error',
      description: 'An unexpected error occurred',
      variant: 'destructive',
    });
  } finally {
    isSubmitting.value = false;
  }
}
</script>

<template>
  <div class="w-full mx-auto">
    <Card class="w-full mx-auto">
      <CardHeader>
        <CardTitle>Send Notification</CardTitle>
        <CardDescription> Fill out the form below to send a push notification </CardDescription>
      </CardHeader>

      <CardContent>
        <form @submit.prevent="sendNotification" class="space-y-6">
          <div>
            <Label for="push-token">Push Token</Label>
            <Input id="push-token" v-model="pushToken" placeholder="Enter push token" required />
          </div>

          <div>
            <Label for="title">Title (Optional)</Label>
            <Input id="title" v-model="title" placeholder="Notification title" />
          </div>

          <div>
            <Label for="body">Body (Required)</Label>
            <Textarea id="body" v-model="body" placeholder="Notification content" required />
          </div>

          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <Label for="group">Group</Label>
              <Input id="group" v-model="group" placeholder="Notification group" />
            </div>

            <div>
              <Label for="category">Category</Label>
              <Input id="category" v-model="category" placeholder="Notification category" />
            </div>
          </div>

          <div>
            <Label for="url">URL (Optional)</Label>
            <Input id="url" v-model="url" type="url" placeholder="URL to open when notification is tapped" />
          </div>

          <div>
            <Label for="icon">Icon URL (Optional)</Label>
            <Input id="icon" v-model="icon" type="url" placeholder="URL to an icon image" />
          </div>

          <div class="flex items-center space-x-2">
            <Checkbox id="preserve-inputs" v-model:checked="preserveInputs" />
            <Label for="preserve-inputs" class="cursor-pointer">Preserve inputs after sending</Label>
          </div>
        </form>
      </CardContent>

      <CardFooter class="flex justify-between gap-4">
        <Button variant="outline" @click="clearForm" type="button" class="w-1/3"> Clear Form </Button>
        <Button type="submit" @click="sendNotification" :disabled="isSubmitting" class="w-2/3">
          {{ isSubmitting ? 'Sending...' : 'Send Notification' }}
        </Button>
      </CardFooter>
    </Card>

    <div v-if="!props.session" class="mt-8 text-center text-gray-500">
      <p>Sign in to use your own push token automatically.</p>
    </div>
  </div>
</template>

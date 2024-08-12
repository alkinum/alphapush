import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import { getDb } from '@/db';
import { userCredentials, pushNotifications, subscriptions } from '@/schema';
import { WebPushService } from '@/services/webPushService';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import { sendSSEvent } from './stream';
import { SubscriptionService } from '@/services/subscriptionService';

interface PushBody {
  pushToken: string;
  content: string;
}

type MarkdownHeader = Record<string, string>;

function parseMarkdownHeader(content: string): MarkdownHeader {
  const trimmedContent = content.trim();
  const headerMatch = trimmedContent.match(/^---\s*\n([\s\S]*?)\n\s*---/);
  if (!headerMatch) return {};

  const header = headerMatch[1];
  const result: MarkdownHeader = {};

  const lines = header.split('\n');
  for (const line of lines) {
    const [key, ...valueParts] = line.split(':').map((part) => part.trim());
    if (key && valueParts.length > 0) {
      result[key] = valueParts.join(':').trim();
    }
  }

  return result;
}

export const POST: APIRoute = async ({ request, locals }) => {
  try {
    const body = (await request.json()) as PushBody;

    if (!body.pushToken || !body.content) {
      return new Response(JSON.stringify({ error: 'Invalid input parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Added content length check
    if (body.content.length > 1000) {
      return new Response(JSON.stringify({ error: 'Content length exceeds 1000 characters limit' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(locals.runtime.env.DB);

    const user = await db.select().from(userCredentials).where(eq(userCredentials.pushToken, body.pushToken)).get();
    if (!user) {
      return new Response(JSON.stringify({ error: 'Invalid push token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const trimmedContent = body.content.trim();
    const header = parseMarkdownHeader(trimmedContent);
    const content = trimmedContent.replace(/^---\s*\n[\s\S]*?\n\s*---\s*\n/, '').trim();

    const notificationData = {
      content,
      title: header.title,
      category: header.category,
      group: header.group,
      userEmail: user.email,
    };

    const notification = await db.insert(pushNotifications).values(notificationData).returning().get();

    const userSubscriptions = await db
      .select()
      .from(subscriptions)
      .where(eq(subscriptions.userEmail, user.email))
      .all();

    interface FailedPush {
      subscriptionId: string;
      reason: string;
    }

    const failedPushes: FailedPush[] = [];

    const webPushService = new WebPushService(user.publicKey, user.privateKey, `mailto:${user.email}`);

    const subscriptionService = new SubscriptionService(locals.runtime.env.DB);
    const subscriptionsToRemove: string[] = [];

    for (const sub of userSubscriptions) {
      const subscription: PushSubscription = JSON.parse(sub.subscription);

      const message = JSON.stringify({
        title: notification.title,
        body: notification.content,
        category: notification.category,
        group: notification.group,
      });

      try {
        await webPushService.sendNotification(subscription, message, {
          ttl: 60,
          topic: header.topic || 'Default',
          urgency: 'normal',
        });
      } catch (error) {
        console.error(`Failed to send push notification to subscription ${sub.id}:`, error);
        failedPushes.push({
          subscriptionId: sub.id,
          reason: (error as Error).message,
        });

        if (error instanceof Error && 'statusCode' in error && error.statusCode === 410) {
          subscriptionsToRemove.push(sub.id);
        }
      }
    }

    // when the server returns 410, means the subscription is expired
    for (const subscriptionId of subscriptionsToRemove) {
      const isDeleted = await subscriptionService.deleteSubscriptionById(subscriptionId);
      if (isDeleted) {
        console.log(`Removed expired subscription: ${subscriptionId}`);
      } else {
        console.error(`Failed to remove expired subscription: ${subscriptionId}`);
      }
    }

    sendSSEvent(user.email, 'newNotification', {
      id: notification.id,
      title: notification.title,
      content: notification.content,
      category: notification.category,
      group: notification.group,
      createdAt: notification.createdAt,
    });

    if (failedPushes.length > 0) {
      return new Response(
        JSON.stringify({
          success: false,
          error: 'Some push notifications failed to send',
          failedPushes,
        }),
        {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        },
      );
    }

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    console.error('Error in push API:', error);
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

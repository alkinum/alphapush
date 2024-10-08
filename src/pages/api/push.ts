import type { APIRoute } from 'astro';
import { eq } from 'drizzle-orm';
import type { PushSubscription } from '@block65/webcrypto-web-push';
import { createId } from '@paralleldrive/cuid2';
import { parse as parseYaml } from 'yaml';
import { getDb } from '@/db';
import { userCredentials, pushNotifications, subscriptions } from '@/schema';
import { WebPushService } from '@/services/webPushService';
import { SubscriptionService } from '@/services/subscriptionService';
import { ApprovalProcessService } from '@/services/approvalProcessService';
import type { Notification } from '@/types/notification';
import { isLocalNetworkUrl } from '@/utils/network';

import { sendSSEvent } from './stream';

interface PushBody {
  pushToken: string;
  content: string;
}

type MarkdownHeader = Record<string, string>;

const MAX_MESSAGE_SIZE = 4096; // 4KB in bytes

function parseMarkdownHeader(content: string): MarkdownHeader {
  const trimmedContent = content.trim();
  const headerMatch = trimmedContent.match(/^---\s*\n([\s\S]*?)\n\s*---/);
  if (!headerMatch) return {};

  const header = headerMatch[1];
  try {
    return parseYaml(header) as MarkdownHeader;
  } catch (error) {
    console.error('Error parsing YAML header:', error);
    return {};
  }
}

/**
 * Checks if a webhook URL is valid and not a local network URL.
 * @param url The webhook URL to check
 * @returns An object with a boolean indicating if the URL is valid and a possible error message
 */
export function validateWebhookUrl(url: string): { isValid: boolean; error?: string } {
  if (!url) {
    return { isValid: false, error: 'Webhook URL is required' };
  }

  try {
    new URL(url);
  } catch (error) {
    return { isValid: false, error: 'Invalid URL format' };
  }

  if (isLocalNetworkUrl(url)) {
    return { isValid: false, error: 'Local network URLs are not allowed for webhooks' };
  }

  return { isValid: true };
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

    const db = getDb(locals.runtime.env.DB);
    const approvalProcessService = new ApprovalProcessService(db);

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

    if (header.icon_url) {
      try {
        const url = new URL(header.icon_url);
        if (url.protocol !== 'https:') {
          return new Response(JSON.stringify({ error: 'Icon URL must use HTTPS protocol' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (error) {
        return new Response(JSON.stringify({ error: 'Invalid icon URL' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let extraInfo: Record<string, any> | undefined;
    if (header.extra) {
      if (typeof header.extra !== 'object' || header.extra === null || Array.isArray(header.extra)) {
        return new Response(JSON.stringify({ error: 'Extra info must be a valid object' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      extraInfo = header.extra;
    }

    const notificationData = {
      content,
      title: header.title,
      category: header.category,
      group: header.group,
      userEmail: user.email,
      iconUrl: header.icon_url,
      type: header.type,
      extraInfo: extraInfo ? JSON.stringify(extraInfo) : null,
    };

    let notification: Notification | undefined;
    let approvalId: string | undefined;
    let tempAccessToken: string | undefined;

    // Insert notification
    notification = await db.insert(pushNotifications).values(notificationData).returning().get();

    if (!notification) {
      throw new Error('Failed to create notification');
    }

    if (header.type === 'approval-process') {
      if (!header.webhook_url) {
        return new Response(JSON.stringify({ error: 'Webhook URL is required for approval process' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // SSRF check
      const { isValid, error } = validateWebhookUrl(header.webhook_url);
      if (!isValid && import.meta.env.DISABLE_SSRF_PROTECTION !== 'true') {
        return new Response(JSON.stringify({ error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Insert approval process
      const approvalProcess = await approvalProcessService.addApprovalProcess({
        notificationId: notification.id,
        webhookUrl: header.webhook_url,
        userEmail: user.email,
      });

      if (!approvalProcess) {
        throw new Error('Failed to create approval process');
      }

      approvalId = approvalProcess.id;

      // Generate and store temporary access token
      tempAccessToken = createId();
      await locals.runtime.env.KV.put(
        `approval_token:${approvalId}`,
        tempAccessToken,
        { expirationTtl: 300 }, // 5 minutes in seconds
      );
    }

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

    // Construct the message outside the loop
    const message = JSON.stringify({
      ...notification,
      approvalState: header.type === 'approval-process' ? 'pending' : undefined,
      approvalId: approvalId,
      tempAccessToken: tempAccessToken,
    });

    // Check message size
    if (new TextEncoder().encode(message).length > MAX_MESSAGE_SIZE) {
      return new Response(JSON.stringify({ error: 'Message size exceeds 4KB limit' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    for (const sub of userSubscriptions) {
      const subscription: PushSubscription = JSON.parse(sub.subscription);

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

        if (error instanceof Error && 'statusCode' in error && (error as any).statusCode === 410) {
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
      ...notification,
      approvalState: header.type === 'approval-process' ? 'pending' : undefined,
      approvalId: approvalId,
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

    const responseData: {
      success: boolean;
      notificationId: string;
      approvalId?: string;
    } = {
      success: true,
      notificationId: notification.id,
    };

    if (header.type === 'approval-process' && approvalId) {
      responseData.approvalId = approvalId;
    }

    return new Response(JSON.stringify(responseData), {
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

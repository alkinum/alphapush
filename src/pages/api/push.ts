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

/**
 * Interface for all possible frontmatter parameters
 */
interface FrontmatterParams {
  title?: string;
  category?: string;
  group?: string;
  icon_url?: string;
  type?: string;
  webhook_url?: string;
  topic?: string;
  extra?: Record<string, any>;
}

interface PushBody {
  pushToken: string;
  content: string;
  // Direct parameters that can override frontmatter
  title?: string;
  category?: string;
  group?: string;
  icon_url?: string;
  type?: string;
  webhook_url?: string;
  topic?: string;
  extra?: Record<string, any>;
}

const MAX_MESSAGE_SIZE = 4096; // 4KB in bytes

/**
 * Parse markdown frontmatter using yaml parser
 * @param content Markdown content with frontmatter
 * @returns Parsed frontmatter and content
 */
function parseMarkdownHeader(content: string): { data: FrontmatterParams; content: string } {
  const trimmedContent = content.trim();
  // Match frontmatter between triple dashes
  const frontmatterRegex = /^---\s*\n([\s\S]*?)\n\s*---\s*\n/;
  const match = trimmedContent.match(frontmatterRegex);

  if (!match) {
    // No frontmatter found, return empty data and original content
    return { data: {}, content: trimmedContent };
  }

  const [fullMatch, yamlContent] = match;

  try {
    // Parse the YAML content
    const data = parseYaml(yamlContent) as FrontmatterParams;

    // Remove frontmatter from content
    const contentWithoutFrontmatter = trimmedContent.replace(fullMatch, '').trim();

    return {
      data,
      content: contentWithoutFrontmatter
    };
  } catch (error) {
    console.error('Error parsing YAML frontmatter:', error);
    // In case of parsing error, return empty data and content without frontmatter
    const contentWithoutFrontmatter = trimmedContent.replace(frontmatterRegex, '').trim();
    return { data: {}, content: contentWithoutFrontmatter || trimmedContent };
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

    // Parse frontmatter and content
    const { data: frontmatterParams, content } = parseMarkdownHeader(body.content);

    // Merge direct parameters with frontmatter (direct parameters take precedence)
    const mergedParams: FrontmatterParams = {
      ...frontmatterParams,
      ...(body.title && { title: body.title }),
      ...(body.category && { category: body.category }),
      ...(body.group && { group: body.group }),
      ...(body.icon_url && { icon_url: body.icon_url }),
      ...(body.type && { type: body.type }),
      ...(body.webhook_url && { webhook_url: body.webhook_url }),
      ...(body.topic && { topic: body.topic }),
      ...(body.extra && { extra: body.extra }),
    };

    if (mergedParams.icon_url) {
      try {
        const url = new URL(mergedParams.icon_url);
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
    if (mergedParams.extra) {
      if (typeof mergedParams.extra !== 'object' || mergedParams.extra === null || Array.isArray(mergedParams.extra)) {
        return new Response(JSON.stringify({ error: 'Extra info must be a valid object' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      extraInfo = mergedParams.extra;
    }

    const notificationData = {
      content,
      title: mergedParams.title,
      category: mergedParams.category,
      group: mergedParams.group,
      userEmail: user.email,
      iconUrl: mergedParams.icon_url,
      type: mergedParams.type,
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

    if (mergedParams.type === 'approval-process') {
      if (!mergedParams.webhook_url) {
        return new Response(JSON.stringify({ error: 'Webhook URL is required for approval process' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // SSRF check
      const { isValid, error } = validateWebhookUrl(mergedParams.webhook_url);
      if (!isValid && import.meta.env.DISABLE_SSRF_PROTECTION !== 'true') {
        return new Response(JSON.stringify({ error }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      // Insert approval process
      const approvalProcess = await approvalProcessService.addApprovalProcess({
        notificationId: notification.id,
        webhookUrl: mergedParams.webhook_url,
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
      approvalState: mergedParams.type === 'approval-process' ? 'pending' : undefined,
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
          topic: mergedParams.topic || 'Default',
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
      approvalState: mergedParams.type === 'approval-process' ? 'pending' : undefined,
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

    if (mergedParams.type === 'approval-process' && approvalId) {
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

import type { APIRoute } from 'astro';
import { parse as parseYaml } from 'yaml';
import { getDb } from '@/db';
import { PushService } from '@/services/pushService';
import { NotificationService } from '@/services/notificationService';
import type { Notification } from '@/types/notification';
import { logger } from '@/utils/logger';

/**
 * Interface for all possible frontmatter parameters
 */
interface FrontmatterParams {
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

interface PushBody {
  pushToken: string;
  content: string;
  // Direct parameters that can override frontmatter
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

/**
 * Interface for Bark API V2 format
 * Based on https://github.com/Finb/bark-server/blob/master/docs/API_V2.md
 */
interface BarkPushBody {
  device_key: string;
  title?: string;
  subtitle?: string;
  body: string;
  badge?: number;
  sound?: string;
  icon?: string;
  notification_group?: string;
  url?: string;
  copy?: string;
  autoCopy?: string;
  isArchive?: string;
  level?: 'critical' | 'active' | 'timeSensitive' | 'passive';
  volume?: string;
  call?: string;
  action?: string;
  ciphertext?: string;
}

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
    logger.error('Error parsing YAML frontmatter:', error);
    // In case of parsing error, return empty data and content without frontmatter
    const contentWithoutFrontmatter = trimmedContent.replace(frontmatterRegex, '').trim();
    return { data: {}, content: contentWithoutFrontmatter || trimmedContent };
  }
}

/**
 * Convert Bark API V2 format to our internal format
 * @param barkBody Bark API V2 request body
 * @returns Converted PushBody format
 */
function convertBarkToPushBody(barkBody: BarkPushBody): PushBody {
  // Create extra object for Bark-specific parameters that don't have direct mappings
  const extra: Record<string, any> = {};

  if (barkBody.badge) extra.badge = barkBody.badge;
  if (barkBody.sound) extra.sound = barkBody.sound;
  if (barkBody.copy) extra.copy = barkBody.copy;
  if (barkBody.autoCopy) extra.autoCopy = barkBody.autoCopy === '1';
  if (barkBody.isArchive) extra.isArchive = barkBody.isArchive === '1';
  if (barkBody.volume) extra.volume = barkBody.volume;
  if (barkBody.call) extra.call = barkBody.call === '1';
  if (barkBody.action) extra.action = barkBody.action;

  // Use ciphertext as content if it exists, otherwise use body
  const content = barkBody.ciphertext || barkBody.body;

  return {
    pushToken: barkBody.device_key,
    content: content,
    title: barkBody.title,
    subtitle: barkBody.subtitle,
    category: barkBody.level, // Map level to category
    group: barkBody.notification_group,
    icon_url: barkBody.icon,
    navigate_url: barkBody.url, // Map url to navigate_url
    extra: Object.keys(extra).length > 0 ? extra : undefined
  };
}

/**
 * Detect if the request is in Bark API V2 format
 * @param body Request body
 * @returns True if the request is in Bark format
 */
function isBarkFormat(body: any): body is BarkPushBody {
  return body && typeof body === 'object' &&
    'device_key' in body &&
    'body' in body &&
    typeof body.body === 'string';
}

export const POST: APIRoute = async ({ request, locals }) => {
  logger.debug('Push API request received');

  try {
    const requestBody = await request.json();
    logger.debug('Request body received:', requestBody);

    // Detect if the request is in Bark API V2 format and convert if needed
    let body: PushBody;
    if (isBarkFormat(requestBody)) {
      logger.debug('Detected Bark API V2 format, converting');
      body = convertBarkToPushBody(requestBody as BarkPushBody);
    } else {
      body = requestBody as PushBody;
    }

    if (!body.pushToken || !body.content) {
      logger.error('Push API error: Missing required parameters', {
        hasToken: !!body.pushToken,
        hasContent: !!body.content
      });
      return new Response(JSON.stringify({ error: 'Invalid input parameters' }), {
        status: 400,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const db = getDb(locals.runtime.env.DB);
    const pushService = new PushService(db, locals.runtime.env);
    const notificationService = new NotificationService(db);

    // Validate push token
    logger.debug('Validating push token');
    const user = await pushService.validatePushToken(body.pushToken);
    if (!user) {
      logger.error('Push API error: Invalid push token', { token: body.pushToken });
      return new Response(JSON.stringify({ error: 'Invalid push token' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    // Parse frontmatter and content
    logger.debug('Parsing content frontmatter');
    const { data: frontmatterParams, content } = parseMarkdownHeader(body.content);
    logger.debug('Frontmatter parsed:', frontmatterParams);

    // Merge direct parameters with frontmatter (direct parameters take precedence)
    const mergedParams: FrontmatterParams = {
      ...frontmatterParams,
      ...(body.title && { title: body.title }),
      ...(body.subtitle && { subtitle: body.subtitle }),
      ...(body.category && { category: body.category }),
      ...(body.group && { group: body.group }),
      ...(body.icon_url && { icon_url: body.icon_url }),
      ...(body.type && { type: body.type }),
      ...(body.webhook_url && { webhook_url: body.webhook_url }),
      ...(body.topic && { topic: body.topic }),
      ...(body.navigate_url && { navigate_url: body.navigate_url }),
      ...(body.extra && { extra: body.extra }),
    };

    if (mergedParams.icon_url) {
      try {
        const url = new URL(mergedParams.icon_url);
        if (url.protocol !== 'https:') {
          logger.error('Push API error: Icon URL must use HTTPS protocol', { url: mergedParams.icon_url });
          return new Response(JSON.stringify({ error: 'Icon URL must use HTTPS protocol' }), {
            status: 400,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      } catch (error) {
        logger.error('Push API error: Invalid icon URL', { url: mergedParams.icon_url });
        return new Response(JSON.stringify({ error: 'Invalid icon URL' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    let extraInfo: Record<string, any> | undefined;
    if (mergedParams.extra) {
      if (typeof mergedParams.extra !== 'object' || mergedParams.extra === null || Array.isArray(mergedParams.extra)) {
        logger.error('Push API error: Extra info must be a valid object', {
          type: typeof mergedParams.extra,
          isNull: mergedParams.extra === null,
          isArray: Array.isArray(mergedParams.extra)
        });
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
      subtitle: mergedParams.subtitle,
      category: mergedParams.category,
      notification_group: mergedParams.group,
      userEmail: user.email,
      iconUrl: mergedParams.icon_url,
      navigate_url: mergedParams.navigate_url,
      type: mergedParams.type,
      extraInfo: extraInfo ? JSON.stringify(extraInfo) : null,
    };

    // Create notification
    logger.debug('Creating notification', {
      userEmail: user.email,
      type: notificationData.type
    });
    // Create notification directly using notificationService instead of pushService
    const notification = await notificationService.createNotification(notificationData);

    if (!notification) {
      logger.error('Push API error: Failed to create notification', {
        userEmail: user.email,
        hasTitle: !!notificationData.title
      });
      throw new Error('Failed to create notification');
    }

    let approvalId: string | undefined;
    let tempAccessToken: string | undefined;

    // Handle approval process if needed
    if (mergedParams.type === 'approval-process') {
      if (!mergedParams.webhook_url) {
        logger.error('Push API error: Webhook URL is required for approval process');
        return new Response(JSON.stringify({ error: 'Webhook URL is required for approval process' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }

      try {
        logger.debug('Creating approval process', {
          notificationId: notification.id,
          webhookUrl: mergedParams.webhook_url
        });
        const notificationForApproval: Notification = {
          ...notification,
          category: mergedParams.category || null,
          group: mergedParams.group || null,
          createdAt: notification.createdAt || new Date(),
          updatedAt: notification.updatedAt || new Date(),
        };

        const result = await pushService.createApprovalProcess(
          notificationForApproval,
          mergedParams.webhook_url,
          user.email
        );
        approvalId = result.approvalId;
        tempAccessToken = result.tempAccessToken;
      } catch (error) {
        logger.error('Push API error: Failed to create approval process', {
          error: (error as Error).message,
          notificationId: notification.id
        });
        return new Response(JSON.stringify({ error: (error as Error).message }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }

    // Send push notifications
    logger.debug('Sending push notifications', {
      notificationId: notification.id,
      hasApprovalId: !!approvalId
    });
    const notificationForPush: Notification = {
      ...notification,
      category: mergedParams.category || null,
      group: mergedParams.group || null,
      createdAt: notification.createdAt || new Date(),
      updatedAt: notification.updatedAt || new Date(),
    };

    const pushResult = await pushService.sendPushNotifications(
      user,
      notificationForPush,
      {
        approvalId,
        tempAccessToken,
        approvalState: mergedParams.type === 'approval-process' ? 'pending' : undefined,
        topic: mergedParams.topic || 'Default',
      }
    );

    if (!pushResult.success) {
      logger.error('Push API error: Failed to send push notifications', {
        error: pushResult.error,
        failedPushesCount: pushResult.failedPushes?.length,
        notificationId: notification.id
      });
      return new Response(
        JSON.stringify({
          success: false,
          error: pushResult.error || 'Some push notifications failed to send',
          failedPushes: pushResult.failedPushes,
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

    logger.debug('Push API success', responseData);
    return new Response(JSON.stringify(responseData), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    logger.error('Push API critical error:', error instanceof Error ? error.message : String(error));
    return new Response(JSON.stringify({ error: 'Internal Server Error' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
};

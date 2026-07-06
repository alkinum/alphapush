import type { UserPreference } from '@/services/userPreferenceService';
import type { Notification } from '@/types/notification';
import { isLocalNetworkUrl } from '@/utils/network';
import { logger } from '@/utils/logger';

type BarkLevel = 'critical' | 'active' | 'timeSensitive' | 'passive';

interface BarkPayload {
  device_key: string;
  title?: string;
  subtitle?: string;
  body: string;
  badge?: number;
  sound?: string;
  icon?: string;
  group?: string;
  url?: string;
  copy?: string;
  autoCopy?: string;
  isArchive?: string;
  level?: BarkLevel;
}

export interface BarkFallbackResult {
  sent: boolean;
  error?: string;
  status?: number;
}

type BarkPreferenceValidation =
  | {
    isValid: true;
    serverUrl: string;
    deviceKey: string;
  }
  | {
    isValid: false;
    error: string;
  };

export interface BarkFallbackTarget {
  barkServerUrl: string;
  barkDeviceKey: string;
}

interface BarkFallbackOptions {
  urgency?: 'normal' | 'high';
}

export class BarkFallbackService {
  constructor(private readonly appUrl?: string) {}

  async sendFallback(
    preferences: UserPreference,
    notification: Notification,
    options: BarkFallbackOptions = {}
  ): Promise<BarkFallbackResult> {
    return this.sendToTarget(preferences, notification, options);
  }

  async sendToTarget(
    target: BarkFallbackTarget,
    notification: Notification,
    options: BarkFallbackOptions = {}
  ): Promise<BarkFallbackResult> {
    const validation = validateBarkTarget(target);
    if (!validation.isValid) {
      return { sent: false, error: validation.error };
    }

    const endpoint = new URL(`${validation.serverUrl}/push`);
    const payload = this.buildPayload(validation.deviceKey, notification, options);

    try {
      const response = await fetch(endpoint.toString(), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const responseData = await parseBarkResponse(response);
      if (!response.ok) {
        return {
          sent: false,
          status: response.status,
          error: responseData?.message || `Bark server responded with ${response.status}`,
        };
      }

      if (responseData?.code !== undefined && Number(responseData.code) !== 200) {
        return {
          sent: false,
          status: response.status,
          error: responseData.message || `Bark server returned code ${responseData.code}`,
        };
      }

      logger.info('Bark fallback sent', {
        notificationId: notification.id,
        barkServerUrl: validation.serverUrl,
      });

      return { sent: true, status: response.status };
    } catch (error) {
      logger.error('Bark fallback request failed:', error);
      return {
        sent: false,
        error: error instanceof Error ? error.message : 'Bark fallback request failed',
      };
    }
  }

  private buildPayload(
    deviceKey: string,
    notification: Notification,
    options: BarkFallbackOptions
  ): BarkPayload {
    const extraInfo = parseExtraInfo(notification.extraInfo);
    const payload: BarkPayload = {
      device_key: deviceKey,
      title: notification.title || 'AlphaPush',
      subtitle: notification.subtitle || undefined,
      body: notification.content,
      group: notification.group || notification.category || undefined,
      icon: notification.iconUrl || undefined,
      url: normalizeNavigateUrl(notification.navigate_url, this.appUrl),
      level: getBarkLevel(notification, options),
    };

    if (typeof extraInfo.sound === 'string') {
      payload.sound = extraInfo.sound;
    }

    if (typeof extraInfo.copy === 'string') {
      payload.copy = extraInfo.copy;
    }

    if (typeof extraInfo.autoCopy === 'boolean') {
      payload.autoCopy = extraInfo.autoCopy ? '1' : '0';
    } else if (typeof extraInfo.autoCopy === 'string') {
      payload.autoCopy = extraInfo.autoCopy;
    }

    if (typeof extraInfo.isArchive === 'boolean') {
      payload.isArchive = extraInfo.isArchive ? '1' : '0';
    } else if (typeof extraInfo.isArchive === 'string') {
      payload.isArchive = extraInfo.isArchive;
    }

    if (typeof extraInfo.badge === 'number' && Number.isFinite(extraInfo.badge)) {
      payload.badge = extraInfo.badge;
    }

    return payload;
  }
}

export function validateBarkPreferences(preferences: UserPreference): BarkPreferenceValidation {
  return validateBarkTarget(preferences);
}

export function validateBarkTarget(target: BarkFallbackTarget): BarkPreferenceValidation {
  const deviceKey = target.barkDeviceKey.trim();
  if (!deviceKey) {
    return { isValid: false, error: 'Bark device key is not configured' };
  }

  let parsedUrl: URL;
  try {
    parsedUrl = new URL(target.barkServerUrl.trim());
  } catch {
    return { isValid: false, error: 'Invalid Bark server URL' };
  }

  if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
    return { isValid: false, error: 'Bark server URL must use http or https' };
  }

  if (isLocalNetworkUrl(parsedUrl.toString())) {
    return { isValid: false, error: 'Local network Bark server URLs are not allowed' };
  }

  parsedUrl.hash = '';
  parsedUrl.search = '';

  return {
    isValid: true,
    serverUrl: parsedUrl.toString().replace(/\/+$/, ''),
    deviceKey,
  };
}

async function parseBarkResponse(response: Response): Promise<{ code?: number; message?: string } | null> {
  const contentType = response.headers.get('Content-Type') || '';
  if (!contentType.includes('application/json')) {
    return null;
  }

  try {
    return (await response.json()) as { code?: number; message?: string };
  } catch {
    return null;
  }
}

function parseExtraInfo(extraInfo?: string | null): Record<string, unknown> {
  if (!extraInfo) {
    return {};
  }

  try {
    const parsed = JSON.parse(extraInfo);
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch (error) {
    logger.warn('Failed to parse notification extra info for Bark fallback', { error });
  }

  return {};
}

function normalizeNavigateUrl(navigateUrl?: string | null, appUrl?: string): string | undefined {
  if (!navigateUrl) {
    return undefined;
  }

  try {
    const baseUrl = appUrl || 'https://push.alkinum.dev';
    const url = new URL(navigateUrl, baseUrl);

    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      return undefined;
    }

    return url.toString();
  } catch {
    return undefined;
  }
}

function getBarkLevel(notification: Notification, options: BarkFallbackOptions): BarkLevel {
  const category = notification.category || undefined;
  if (isBarkLevel(category)) {
    return category;
  }

  if (notification.type === 'critical') {
    return 'critical';
  }

  if (options.urgency === 'high' || notification.type === 'approval-process') {
    return 'timeSensitive';
  }

  return 'active';
}

function isBarkLevel(value?: string): value is BarkLevel {
  return value === 'critical' || value === 'active' || value === 'timeSensitive' || value === 'passive';
}

export interface PushApiResponse {
  success?: boolean;
  notificationId?: string;
  approvalId?: string;
  error?: string;
  deliveryWarning?: string;
  successfulPushes?: number;
  failedPushes?: Array<{ subscriptionId: string; reason: string }>;
  ignoredPushFailures?: Array<{ subscriptionId: string; reason: string }>;
  removedSubscriptions?: number;
  barkFallbackSent?: boolean;
  barkFallbackReason?: string;
  barkFallbackError?: string;
}

export function hasConfirmedPushDelivery(result: PushApiResponse): boolean {
  return result.success === true || Number(result.successfulPushes || 0) > 0 || result.barkFallbackSent === true;
}

export function getPushDeliveryWarning(result: PushApiResponse): string | undefined {
  if (result.deliveryWarning) {
    return result.deliveryWarning;
  }

  const removedSubscriptions = result.removedSubscriptions || result.ignoredPushFailures?.length || 0;
  const warnings: string[] = [];

  if (hasConfirmedPushDelivery(result) && result.failedPushes?.length) {
    warnings.push(
      `${result.failedPushes.length} other device${result.failedPushes.length === 1 ? '' : 's'} failed to receive it.`
    );
  }

  if (hasConfirmedPushDelivery(result) && removedSubscriptions > 0) {
    warnings.push(
      `Removed ${removedSubscriptions} stale device subscription${removedSubscriptions === 1 ? '' : 's'}.`
    );
  }

  if (warnings.length > 0) {
    return warnings.join(' ');
  }

  return undefined;
}

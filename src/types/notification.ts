export interface Notification {
  id: string;
  content: string;
  title?: string | null;
  subtitle?: string | null;
  userEmail: string;
  createdAt: Date;
  updatedAt: Date;
  iconUrl?: string | null;
  navigate_url?: string | null;
  type?: string | null;
  extraInfo?: string | null;
  category?: string | null; // 类别名称
  group?: string | null; // 组名称
  categoryId?: string | null; // 类别 ID
  groupId?: string | null; // 组 ID
  approvalId?: string; // 审批流程 ID
  approvalState?: string; // 审批状态
  webPushSentAt?: Date | null;
  webPushDisplayedAt?: Date | null;
  webPushOpenedAt?: Date | null;
  barkFallbackSentAt?: Date | null;
  barkFallbackReason?: string | null;
  barkFallbackError?: string | null;
  readAt?: Date | null;
  badgeCount?: number;
}

export interface NotificationGroup {
  id: string;
  name: string;
  count: number;
}

export interface NotificationCategory {
  id: string;
  name: string;
  count: number;
}

import type { InferSelectModel } from 'drizzle-orm';
import type { pushNotifications } from '@/schema';
import type { ApprovalState } from './approval';

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

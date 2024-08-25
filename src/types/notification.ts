import type { InferSelectModel } from 'drizzle-orm';
import type { pushNotifications } from '@/schema';
import type { ApprovalState } from './approval';

export type Notification = InferSelectModel<typeof pushNotifications> & { isNew?: boolean; isDeleting?: boolean } & {
  approvalId?: string;
  approvalState?: ApprovalState;
};

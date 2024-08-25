import type { InferSelectModel } from 'drizzle-orm';
import type { pushNotifications } from '@/schema';

export type Notification = InferSelectModel<typeof pushNotifications> & { isNew?: boolean; isDeleting?: boolean };

import { eq, and, desc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { pushNotifications, categories, groups } from '@/schema';
import type { Notification } from '@/types/notification';
import { logger } from '@/utils/logger';
import { sendSSEvent } from '@/pages/api/stream';

export interface NotificationCreateData {
  content: string;
  title?: string;
  subtitle?: string;
  category?: string;
  group?: string;
  userEmail: string;
  iconUrl?: string;
  navigate_url?: string;
  type?: string;
  extraInfo?: string | null;
}

export interface NotificationUpdateData {
  content?: string;
  title?: string;
  subtitle?: string;
  category?: string;
  group?: string;
  iconUrl?: string;
  navigate_url?: string;
  type?: string;
  extraInfo?: string | null;
}

export interface NotificationFilterOptions {
  page?: number;
  pageSize?: number;
  group?: string;
  category?: string;
}

export interface NotificationListResponse {
  notifications: Notification[];
  totalCount: number;
  totalPages: number;
}

export class NotificationService {
  private db: ReturnType<typeof getDb>;

  constructor(db: ReturnType<typeof getDb>) {
    this.db = db;
    logger.info('NotificationService initialized');
  }

  /**
   * Get notifications list
   * @param userEmail User email
   * @param options Filter options
   * @returns Notification list response
   */
  async getNotifications(
    userEmail: string,
    options: NotificationFilterOptions = {}
  ): Promise<NotificationListResponse> {
    logger.debug(`Getting notifications for user: ${userEmail} with options: ${JSON.stringify(options)}`);

    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;

    // Basic condition: user email match
    let whereClause: SQL<unknown> = eq(pushNotifications.userEmail, userEmail);

    // If group is specified, add group filter condition
    if (options.group && options.group !== 'all') {
      logger.debug(`Filtering by group ID: ${options.group}`);

      // Check if the group exists with this ID
      const groupById = await this.db
        .select()
        .from(groups)
        .where(and(eq(groups.userEmail, userEmail), eq(groups.id, options.group)))
        .get();

      if (groupById) {
        const groupCondition = eq(pushNotifications.groupId, groupById.id);
        whereClause = and(whereClause, groupCondition) as SQL<unknown>;
        logger.debug(`Group found with ID: ${groupById.id}`);
      } else {
        logger.warn(`Group not found with ID: ${options.group}`);
      }
    }

    // If category is specified, add category filter condition
    if (options.category && options.category !== 'all') {
      logger.debug(`Filtering by category ID: ${options.category}`);

      // Check if the category exists with this ID
      const categoryById = await this.db
        .select()
        .from(categories)
        .where(and(
          eq(categories.userEmail, userEmail),
          eq(categories.id, options.category)
        ))
        .get();

      if (categoryById) {
        const categoryCondition = eq(pushNotifications.categoryId, categoryById.id);
        whereClause = and(whereClause, categoryCondition) as SQL<unknown>;
        logger.debug(`Category found with ID: ${categoryById.id}`);
      } else {
        logger.warn(`Category not found with ID: ${options.category}`);
      }
    }

    // Get notification list and total count
    try {
      const [notificationsResult, totalCountResult] = await Promise.all([
        this.db
          .select()
          .from(pushNotifications)
          .where(whereClause)
          .orderBy(desc(pushNotifications.createdAt))
          .limit(pageSize)
          .offset(offset)
          .all(),
        this.db
          .select({ count: sql`count(*)` })
          .from(pushNotifications)
          .where(whereClause)
          .get(),
      ]);

      logger.debug(`Found ${notificationsResult.length} notifications`);

      // Get associated category and group information for notifications
      const notificationsWithDetails = await Promise.all(
        notificationsResult.map(async (notification) => {
          let categoryName: string | null = null;
          let groupName: string | null = null;

          // Get category information
          if (notification.categoryId) {
            const category = await this.db
              .select({ name: categories.name })
              .from(categories)
              .where(eq(categories.id, notification.categoryId))
              .get();
            if (category) {
              categoryName = category.name;
            }
          }

          // Get group information
          if (notification.groupId) {
            const group = await this.db
              .select({ name: groups.name })
              .from(groups)
              .where(eq(groups.id, notification.groupId))
              .get();
            if (group) {
              groupName = group.name;
            }
          }

          return {
            ...notification,
            category: categoryName,
            group: groupName,
          } as Notification;
        })
      );

      const totalCount = totalCountResult?.count ?? 0;
      const totalPages = Math.ceil(Number(totalCount) / pageSize);

      logger.info(`Retrieved ${notificationsWithDetails.length} notifications for user ${userEmail}, total count: ${totalCount}`);

      return {
        notifications: notificationsWithDetails,
        totalCount: Number(totalCount),
        totalPages,
      };
    } catch (error) {
      logger.error(`Error retrieving notifications: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get a single notification
   * @param notificationId Notification ID
   * @param userEmail User email
   * @returns Notification object
   */
  async getNotification(notificationId: string, userEmail: string): Promise<Notification | undefined> {
    logger.debug(`Getting notification ${notificationId} for user ${userEmail}`);

    try {
      const notification = await this.db
        .select()
        .from(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
        .get();

      if (!notification) {
        logger.warn(`Notification ${notificationId} not found for user ${userEmail}`);
        return undefined;
      }

      let categoryName: string | null = null;
      let groupName: string | null = null;

      // Get category information
      if (notification.categoryId) {
        const category = await this.db
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, notification.categoryId))
          .get();
        if (category) {
          categoryName = category.name;
        }
      }

      // Get group information
      if (notification.groupId) {
        const group = await this.db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, notification.groupId))
          .get();
        if (group) {
          groupName = group.name;
        }
      }

      logger.debug(`Found notification ${notificationId} with category ${categoryName} and group ${groupName}`);

      return {
        ...notification,
        category: categoryName,
        group: groupName,
      } as Notification;
    } catch (error) {
      logger.error(`Error getting notification ${notificationId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Create a notification
   * @param data Notification data
   * @returns Created notification
   */
  async createNotification(data: NotificationCreateData): Promise<Notification | undefined> {
    logger.debug(`Creating notification for user ${data.userEmail}: ${JSON.stringify({
      title: data.title,
      category: data.category,
      group: data.group
    })}`);

    try {
      // Process category and group
      let categoryId: string | null = null;
      let groupId: string | null = null;

      // If group is provided, get or create the group
      if (data.group) {
        logger.debug(`Processing group name: ${data.group}`);

        // Check if the group exists with this name
        const existingGroup = await this.db
          .select()
          .from(groups)
          .where(and(eq(groups.userEmail, data.userEmail), eq(groups.name, data.group)))
          .get();

        if (existingGroup) {
          groupId = existingGroup.id;
          logger.debug(`Using existing group ID: ${groupId} for name: ${data.group}`);
        } else if (data.group !== 'all') {
          // If not found and not 'all', create a new group with the given name
          const newGroup = await this.getOrCreateGroup(data.userEmail, data.group);
          if (newGroup) {
            groupId = newGroup.id;
            logger.debug(`Created new group with ID: ${groupId} for name: ${data.group}`);
          }
        }
      } else if (data.category && data.category !== 'all') {
        // Create or get default group if category is provided but no group
        logger.debug('Category provided without group, using default group');
        const defaultGroup = await this.getOrCreateGroup(data.userEmail, 'Default');
        if (defaultGroup) {
          groupId = defaultGroup.id;
          logger.debug(`Using default group ID: ${groupId}`);
        }
      }

      // If category is provided, get or create the category
      if (data.category && groupId) {
        logger.debug(`Processing category name: ${data.category}`);

        // Check if the category exists with this name in the group
        const existingCategory = await this.db
          .select()
          .from(categories)
          .where(and(
            eq(categories.userEmail, data.userEmail),
            eq(categories.name, data.category),
            eq(categories.groupId, groupId)
          ))
          .get();

        if (existingCategory) {
          categoryId = existingCategory.id;
          logger.debug(`Using existing category ID: ${categoryId} for name: ${data.category}`);
        } else if (data.category !== 'all') {
          // If not found and not 'all', create a new category with the given name
          const newCategory = await this.getOrCreateCategory(data.userEmail, data.category, groupId);
          if (newCategory) {
            categoryId = newCategory.id;
            logger.debug(`Created new category with ID: ${categoryId} for name: ${data.category}`);
          }
        }
      }

      // Create notification
      const notification = await this.db
        .insert(pushNotifications)
        .values({
          content: data.content,
          title: data.title,
          subtitle: data.subtitle,
          categoryId,
          groupId,
          userEmail: data.userEmail,
          iconUrl: data.iconUrl,
          navigate_url: data.navigate_url,
          type: data.type,
          extraInfo: data.extraInfo,
        })
        .returning()
        .get();

      if (!notification) {
        logger.warn(`Failed to create notification for user ${data.userEmail}`);
        return undefined;
      }

      logger.info(`Created notification with ID ${notification.id} for user ${data.userEmail}`);

      // Get category and group names for the response
      let categoryName: string | null = null;
      let groupName: string | null = null;

      if (categoryId) {
        const category = await this.db
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, categoryId))
          .get();

        if (category) {
          categoryName = category.name;
        }
      }

      if (groupId) {
        const group = await this.db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, groupId))
          .get();

        if (group) {
          groupName = group.name;
        }
      }

      // Return notification with category and group information
      const notificationWithDetails = {
        ...notification,
        category: categoryName,
        group: groupName,
        categoryId,
        groupId
      } as Notification;

      return notificationWithDetails;
    } catch (error) {
      logger.error(`Error creating notification: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Update a notification
   * @param notificationId Notification ID
   * @param userEmail User email
   * @param data Update data
   * @returns Updated notification
   */
  async updateNotification(
    notificationId: string,
    userEmail: string,
    data: NotificationUpdateData
  ): Promise<Notification | undefined> {
    logger.debug(`Updating notification ${notificationId} for user ${userEmail}: ${JSON.stringify(data)}`);

    try {
      // Get original notification
      const oldNotification = await this.db
        .select()
        .from(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
        .get();

      if (!oldNotification) {
        logger.warn(`Notification ${notificationId} not found for update`);
        return undefined;
      }

      // Process category and group
      let categoryId = oldNotification.categoryId;
      let groupId = oldNotification.groupId;

      // If group is provided, update the group ID
      if (data.group !== undefined) {
        if (data.group && data.group !== 'all') {
          logger.debug(`Updating to group name: ${data.group}`);

          // Check if the group exists with this name
          const existingGroup = await this.db
            .select()
            .from(groups)
            .where(and(eq(groups.userEmail, userEmail), eq(groups.name, data.group)))
            .get();

          if (existingGroup) {
            groupId = existingGroup.id;
            logger.debug(`Using existing group ID: ${groupId} for name: ${data.group}`);
          } else {
            // If not found, create a new group with the given name
            const newGroup = await this.getOrCreateGroup(userEmail, data.group);
            if (newGroup) {
              groupId = newGroup.id;
              logger.debug(`Created new group with ID: ${groupId} for name: ${data.group}`);
            }
          }
        } else {
          logger.debug('Removing group from notification');
          groupId = null;
          // If we're removing the group, we also need to remove the category
          categoryId = null;
        }
      } else if (data.category !== undefined && data.category !== 'all' && !groupId) {
        // If category is being updated without an existing group, create/get default group
        logger.debug('Category update provided without group, using default group');
        const defaultGroup = await this.getOrCreateGroup(userEmail, 'Default');
        if (defaultGroup) {
          groupId = defaultGroup.id;
          logger.debug(`Using default group ID: ${groupId}`);
        }
      }

      // If category is provided, update the category ID
      if (data.category !== undefined && groupId) {
        if (data.category && data.category !== 'all') {
          logger.debug(`Updating to category name: ${data.category}`);

          // Check if the category exists with this name in the group
          const existingCategory = await this.db
            .select()
            .from(categories)
            .where(and(
              eq(categories.userEmail, userEmail),
              eq(categories.name, data.category),
              eq(categories.groupId, groupId)
            ))
            .get();

          if (existingCategory) {
            categoryId = existingCategory.id;
            logger.debug(`Using existing category ID: ${categoryId} for name: ${data.category}`);
          } else {
            // If not found, create a new category with the given name
            const newCategory = await this.getOrCreateCategory(userEmail, data.category, groupId);
            if (newCategory) {
              categoryId = newCategory.id;
              logger.debug(`Created new category with ID: ${categoryId} for name: ${data.category}`);
            }
          }
        } else {
          logger.debug('Removing category from notification');
          categoryId = null;
        }
      } else if (data.category !== undefined && !groupId) {
        // If we have a category but no group, we can't assign it
        logger.debug('Cannot set category without a group');
        categoryId = null;
      }

      // Update notification
      const updatedNotification = await this.db
        .update(pushNotifications)
        .set({
          content: data.content !== undefined ? data.content : undefined,
          title: data.title !== undefined ? data.title : undefined,
          subtitle: data.subtitle !== undefined ? data.subtitle : undefined,
          categoryId,
          groupId,
          iconUrl: data.iconUrl !== undefined ? data.iconUrl : undefined,
          navigate_url: data.navigate_url !== undefined ? data.navigate_url : undefined,
          type: data.type !== undefined ? data.type : undefined,
          extraInfo: data.extraInfo !== undefined ? data.extraInfo : undefined,
          updatedAt: new Date(),
        })
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
        .returning()
        .get();

      if (!updatedNotification) {
        logger.warn(`Failed to update notification ${notificationId}`);
        return undefined;
      }

      // Get updated category and group information
      let categoryName: string | null = null;
      let groupName: string | null = null;

      // Get category information
      if (updatedNotification.categoryId) {
        const category = await this.db
          .select({ name: categories.name })
          .from(categories)
          .where(eq(categories.id, updatedNotification.categoryId))
          .get();
        if (category) {
          categoryName = category.name;
        }
      }

      // Get group information
      if (updatedNotification.groupId) {
        const group = await this.db
          .select({ name: groups.name })
          .from(groups)
          .where(eq(groups.id, updatedNotification.groupId))
          .get();
        if (group) {
          groupName = group.name;
        }
      }

      logger.info(`Updated notification ${notificationId} for user ${userEmail}`);

      // Return notification with category and group information
      const notificationWithDetails = {
        ...updatedNotification,
        category: categoryName,
        group: groupName,
      } as Notification;

      return notificationWithDetails;
    } catch (error) {
      logger.error(`Error updating notification ${notificationId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Delete a notification
   * @param notificationId Notification ID
   * @param userEmail User email
   * @returns Deleted notification
   */
  async deleteNotification(notificationId: string, userEmail: string): Promise<Notification | undefined> {
    logger.debug(`Deleting notification ${notificationId} for user ${userEmail}`);

    try {
      // Get notification information to return after deletion
      const notification = await this.getNotification(notificationId, userEmail);

      if (!notification) {
        logger.warn(`Notification ${notificationId} not found for deletion`);
        return undefined;
      }

      // Delete notification
      await this.db
        .delete(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)));

      logger.info(`Deleted notification ${notificationId} for user ${userEmail}`);

      return notification;
    } catch (error) {
      logger.error(`Error deleting notification ${notificationId}: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get or create a category
   * @param userEmail User email
   * @param name Category name
   * @param groupId Group ID
   * @returns Category object
   */
  async getOrCreateCategory(userEmail: string, name: string, groupId: string) {
    logger.debug(`Getting or creating category "${name}" for user ${userEmail} in group ${groupId}`);

    try {
      // Find existing category
      const existingCategory = await this.db
        .select()
        .from(categories)
        .where(and(
          eq(categories.userEmail, userEmail),
          eq(categories.name, name),
          eq(categories.groupId, groupId)
        ))
        .get();

      if (existingCategory) {
        logger.debug(`Found existing category: ${existingCategory.id}`);
        return existingCategory;
      }

      // Create new category
      const newCategory = await this.db
        .insert(categories)
        .values({
          userEmail,
          name,
          groupId,
        })
        .returning()
        .get();

      logger.info(`Created new category "${name}" with ID ${newCategory.id} for user ${userEmail} in group ${groupId}`);
      return newCategory;
    } catch (error) {
      logger.error(`Error getting/creating category "${name}": ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get or create a group
   * @param userEmail User email
   * @param name Group name
   * @returns Group object
   */
  async getOrCreateGroup(userEmail: string, name: string) {
    logger.debug(`Getting or creating group "${name}" for user ${userEmail}`);

    try {
      // Find existing group
      const existingGroup = await this.db
        .select()
        .from(groups)
        .where(and(eq(groups.userEmail, userEmail), eq(groups.name, name)))
        .get();

      if (existingGroup) {
        logger.debug(`Found existing group: ${existingGroup.id}`);
        return existingGroup;
      }

      // Create new group
      const newGroup = await this.db
        .insert(groups)
        .values({
          userEmail,
          name,
        })
        .returning()
        .get();

      logger.info(`Created new group "${name}" with ID ${newGroup.id} for user ${userEmail}`);
      return newGroup;
    } catch (error) {
      logger.error(`Error getting/creating group "${name}": ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get all categories for a user
   * @param userEmail User email
   * @returns Categories list
   */
  async getCategories(userEmail: string) {
    logger.debug(`Getting all categories for user ${userEmail}`);

    try {
      // Get all categories with their groups and notification counts
      const categoriesWithCount = await this.db
        .select({
          id: categories.id,
          name: categories.name,
          groupId: categories.groupId,
          groupName: groups.name,
          count: sql`COUNT(${pushNotifications.id})`,
        })
        .from(categories)
        .leftJoin(
          groups,
          eq(categories.groupId, groups.id)
        )
        .leftJoin(
          pushNotifications,
          and(
            eq(categories.id, pushNotifications.categoryId),
            eq(pushNotifications.userEmail, userEmail)
          )
        )
        .where(eq(categories.userEmail, userEmail))
        .groupBy(categories.id, groups.name)
        .all();

      const totalCount = await this.getTotalNotificationCount(userEmail);
      logger.info(`Found ${categoriesWithCount.length} categories for user ${userEmail}, total notifications: ${totalCount}`);

      // Merge categories with the same name and sum their counts
      const mergedCategories = new Map<string, {
        id: string,
        name: string,
        count: number,
        groups: Set<string>,
        groupIds: Set<string>
      }>();

      categoriesWithCount.forEach(cat => {
        if (!cat.groupName || !cat.groupId) return;

        const existing = mergedCategories.get(cat.name);
        if (existing) {
          existing.count += Number(cat.count);
          existing.groups.add(cat.groupName);
          existing.groupIds.add(cat.groupId);
        } else {
          mergedCategories.set(cat.name, {
            id: cat.id,
            name: cat.name,
            count: Number(cat.count),
            groups: new Set([cat.groupName]),
            groupIds: new Set([cat.groupId])
          });
        }
      });

      // Convert merged categories to array format
      const formattedCategories = Array.from(mergedCategories.values()).map(cat => ({
        id: cat.id,
        name: cat.name,
        count: cat.count,
        groups: Array.from(cat.groups),
        groupIds: Array.from(cat.groupIds)
      }));

      return [
        { id: 'all', name: 'All', count: totalCount, groups: [], groupIds: [] },
        ...formattedCategories,
      ];
    } catch (error) {
      logger.error(`Error getting categories: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get all groups for a user
   * @param userEmail User email
   * @returns Groups list
   */
  async getGroups(userEmail: string) {
    logger.debug(`Getting all groups for user ${userEmail}`);

    try {
      // Get all groups and their notification counts
      const groupsWithCount = await this.db
        .select({
          id: groups.id,
          name: groups.name,
          count: sql`COUNT(${pushNotifications.id})`,
        })
        .from(groups)
        .leftJoin(
          pushNotifications,
          and(
            eq(groups.id, pushNotifications.groupId),
            eq(pushNotifications.userEmail, userEmail)
          )
        )
        .where(eq(groups.userEmail, userEmail))
        .groupBy(groups.id)
        .all();

      const totalCount = await this.getTotalNotificationCount(userEmail);
      logger.info(`Found ${groupsWithCount.length} groups for user ${userEmail}, total notifications: ${totalCount}`);

      return [
        { id: 'all', name: 'All Groups', count: totalCount },
        ...groupsWithCount,
      ];
    } catch (error) {
      logger.error(`Error getting groups: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get all categories for a specific group
   * @param userEmail User email
   * @param groupId Group ID
   * @returns Categories list
   */
  async getCategoriesByGroup(userEmail: string, groupId: string) {
    logger.debug(`Getting categories for group ID "${groupId}" and user ${userEmail}`);

    if (groupId === 'all') {
      logger.debug('Getting all categories as group is "all"');
      return this.getCategories(userEmail);
    }

    try {
      // Get group information
      const group = await this.db
        .select()
        .from(groups)
        .where(and(eq(groups.userEmail, userEmail), eq(groups.id, groupId)))
        .get();

      if (!group) {
        logger.warn(`Group with ID "${groupId}" not found for user ${userEmail}`);
        return [{ id: 'all', name: 'All', count: 0 }];
      }

      // Get all categories for this group and their notification counts
      const categoriesWithCount = await this.db
        .select({
          id: categories.id,
          name: categories.name,
          count: sql`COUNT(${pushNotifications.id})`,
        })
        .from(categories)
        .leftJoin(
          pushNotifications,
          and(
            eq(categories.id, pushNotifications.categoryId),
            eq(pushNotifications.userEmail, userEmail)
          )
        )
        .where(and(
          eq(categories.userEmail, userEmail),
          eq(categories.groupId, groupId)
        ))
        .groupBy(categories.id)
        .all();

      // Get total notification count for this group
      const groupNotificationCount = await this.db
        .select({ count: sql`COUNT(*)` })
        .from(pushNotifications)
        .where(
          and(
            eq(pushNotifications.userEmail, userEmail),
            eq(pushNotifications.groupId, groupId)
          )
        )
        .get();

      const notificationCount = Number(groupNotificationCount?.count || 0);
      logger.info(`Found ${categoriesWithCount.length} categories for group "${group.name}", total notifications: ${notificationCount}`);

      return [
        { id: 'all', name: 'All', count: notificationCount },
        ...categoriesWithCount,
      ];
    } catch (error) {
      logger.error(`Error getting categories for group ID "${groupId}": ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }

  /**
   * Get total notification count for user
   * @param userEmail User email
   * @returns Total notification count
   */
  private async getTotalNotificationCount(userEmail: string) {
    logger.debug(`Getting total notification count for user ${userEmail}`);

    try {
      const result = await this.db
        .select({ count: sql`COUNT(*)` })
        .from(pushNotifications)
        .where(eq(pushNotifications.userEmail, userEmail))
        .get();

      const count = Number(result?.count || 0);
      logger.debug(`User ${userEmail} has ${count} total notifications`);
      return count;
    } catch (error) {
      logger.error(`Error getting total notification count: ${error instanceof Error ? error.message : String(error)}`);
      throw error;
    }
  }
} 
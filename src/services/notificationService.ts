import { eq, and, desc, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { getDb } from '@/db';
import { pushNotifications, categories, groups } from '@/schema';
import type { Notification } from '@/types/notification';

export interface NotificationCreateData {
  content: string;
  title?: string;
  subtitle?: string;
  category?: string; // 类别的名称
  group?: string; // 组的名称
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
  category?: string; // 类别的名称
  group?: string; // 组的名称
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
  }

  /**
   * 获取通知列表
   * @param userEmail 用户邮箱
   * @param options 过滤选项
   * @returns 通知列表响应
   */
  async getNotifications(
    userEmail: string,
    options: NotificationFilterOptions = {}
  ): Promise<NotificationListResponse> {
    const page = options.page || 1;
    const pageSize = options.pageSize || 10;
    const offset = (page - 1) * pageSize;

    // 基本条件：用户邮箱匹配
    let whereClause: SQL<unknown> = eq(pushNotifications.userEmail, userEmail);

    // 如果指定了组，添加组过滤条件
    if (options.group && options.group !== 'all') {
      // 先获取组 ID
      const group = await this.getOrCreateGroup(userEmail, options.group);
      if (group) {
        const groupCondition = eq(pushNotifications.groupId, group.id);
        whereClause = and(whereClause, groupCondition) as SQL<unknown>;
      }
    }

    // 如果指定了类别，添加类别过滤条件
    if (options.category && options.category !== 'all') {
      // 先获取类别 ID
      const category = await this.getOrCreateCategory(userEmail, options.category);
      if (category) {
        const categoryCondition = eq(pushNotifications.categoryId, category.id);
        whereClause = and(whereClause, categoryCondition) as SQL<unknown>;
      }
    }

    // 获取通知列表和总数
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

    // 获取通知关联的类别和组信息
    const notificationsWithDetails = await Promise.all(
      notificationsResult.map(async (notification) => {
        let categoryName: string | null = null;
        let groupName: string | null = null;

        // 获取类别信息
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

        // 获取组信息
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

    return {
      notifications: notificationsWithDetails,
      totalCount: Number(totalCount),
      totalPages,
    };
  }

  /**
   * 获取单个通知
   * @param notificationId 通知 ID
   * @param userEmail 用户邮箱
   * @returns 通知对象
   */
  async getNotification(notificationId: string, userEmail: string): Promise<Notification | undefined> {
    const notification = await this.db
      .select()
      .from(pushNotifications)
      .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
      .get();

    if (!notification) {
      return undefined;
    }

    let categoryName: string | null = null;
    let groupName: string | null = null;

    // 获取类别信息
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

    // 获取组信息
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
  }

  /**
   * 创建通知
   * @param data 通知数据
   * @returns 创建的通知
   */
  async createNotification(data: NotificationCreateData): Promise<Notification | undefined> {
    try {
      // 处理类别和组
      let categoryId: string | null = null;
      let groupId: string | null = null;

      // 如果提供了类别，获取或创建类别
      if (data.category) {
        const category = await this.getOrCreateCategory(data.userEmail, data.category);
        if (category) {
          categoryId = category.id;
        }
      }

      // 如果提供了组，获取或创建组
      if (data.group) {
        const group = await this.getOrCreateGroup(data.userEmail, data.group);
        if (group) {
          groupId = group.id;
        }
      }

      // 创建通知
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
        return undefined;
      }

      // 返回带有类别和组信息的通知
      return {
        ...notification,
        category: data.category || null,
        group: data.group || null,
      } as Notification;
    } catch (error) {
      console.error('Error creating notification:', error);
      throw error;
    }
  }

  /**
   * 更新通知
   * @param notificationId 通知 ID
   * @param userEmail 用户邮箱
   * @param data 更新数据
   * @returns 更新后的通知
   */
  async updateNotification(
    notificationId: string,
    userEmail: string,
    data: NotificationUpdateData
  ): Promise<Notification | undefined> {
    try {
      // 获取原通知
      const oldNotification = await this.db
        .select()
        .from(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)))
        .get();

      if (!oldNotification) {
        return undefined;
      }

      // 处理类别和组
      let categoryId = oldNotification.categoryId;
      let groupId = oldNotification.groupId;

      // 如果提供了类别，获取或创建类别
      if (data.category !== undefined) {
        if (data.category) {
          const category = await this.getOrCreateCategory(userEmail, data.category);
          if (category) {
            categoryId = category.id;
          }
        } else {
          categoryId = null;
        }
      }

      // 如果提供了组，获取或创建组
      if (data.group !== undefined) {
        if (data.group) {
          const group = await this.getOrCreateGroup(userEmail, data.group);
          if (group) {
            groupId = group.id;
          }
        } else {
          groupId = null;
        }
      }

      // 更新通知
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
        return undefined;
      }

      // 获取更新后的类别和组信息
      let categoryName: string | null = null;
      let groupName: string | null = null;

      // 获取类别信息
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

      // 获取组信息
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

      // 返回带有类别和组信息的通知
      return {
        ...updatedNotification,
        category: categoryName,
        group: groupName,
      } as Notification;
    } catch (error) {
      console.error('Error updating notification:', error);
      throw error;
    }
  }

  /**
   * 删除通知
   * @param notificationId 通知 ID
   * @param userEmail 用户邮箱
   * @returns 删除的通知
   */
  async deleteNotification(notificationId: string, userEmail: string): Promise<Notification | undefined> {
    try {
      // 获取通知信息，以便在删除后返回
      const notification = await this.getNotification(notificationId, userEmail);

      if (!notification) {
        return undefined;
      }

      // 删除通知
      await this.db
        .delete(pushNotifications)
        .where(and(eq(pushNotifications.id, notificationId), eq(pushNotifications.userEmail, userEmail)));

      return notification;
    } catch (error) {
      console.error('Error deleting notification:', error);
      throw error;
    }
  }

  /**
   * 获取或创建类别
   * @param userEmail 用户邮箱
   * @param name 类别名称
   * @returns 类别对象
   */
  private async getOrCreateCategory(userEmail: string, name: string) {
    // 查找现有类别
    const existingCategory = await this.db
      .select()
      .from(categories)
      .where(and(eq(categories.userEmail, userEmail), eq(categories.name, name)))
      .get();

    if (existingCategory) {
      return existingCategory;
    }

    // 创建新类别
    return await this.db
      .insert(categories)
      .values({
        userEmail,
        name,
      })
      .returning()
      .get();
  }

  /**
   * 获取或创建组
   * @param userEmail 用户邮箱
   * @param name 组名称
   * @returns 组对象
   */
  private async getOrCreateGroup(userEmail: string, name: string) {
    // 查找现有组
    const existingGroup = await this.db
      .select()
      .from(groups)
      .where(and(eq(groups.userEmail, userEmail), eq(groups.name, name)))
      .get();

    if (existingGroup) {
      return existingGroup;
    }

    // 创建新组
    return await this.db
      .insert(groups)
      .values({
        userEmail,
        name,
      })
      .returning()
      .get();
  }

  /**
   * 获取用户的所有类别
   * @param userEmail 用户邮箱
   * @returns 类别列表
   */
  async getCategories(userEmail: string) {
    // 获取所有类别及其通知数量
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
      .where(eq(categories.userEmail, userEmail))
      .groupBy(categories.id)
      .all();

    return [
      { id: 'all', name: 'All', count: await this.getTotalNotificationCount(userEmail) },
      ...categoriesWithCount,
    ];
  }

  /**
   * 获取用户的所有组
   * @param userEmail 用户邮箱
   * @returns 组列表
   */
  async getGroups(userEmail: string) {
    // 获取所有组及其通知数量
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

    return [
      { id: 'all', name: 'All Groups', count: await this.getTotalNotificationCount(userEmail) },
      ...groupsWithCount,
    ];
  }

  /**
   * 获取特定组下的所有类别
   * @param userEmail 用户邮箱
   * @param groupName 组名称
   * @returns 类别列表
   */
  async getCategoriesByGroup(userEmail: string, groupName: string) {
    if (groupName === 'all') {
      return this.getCategories(userEmail);
    }

    // 获取组 ID
    const group = await this.getOrCreateGroup(userEmail, groupName);
    if (!group) {
      return [{ id: 'all', name: 'All', count: 0 }];
    }

    // 获取该组下的所有类别及其通知数量
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
          eq(pushNotifications.groupId, group.id),
          eq(pushNotifications.userEmail, userEmail)
        )
      )
      .where(eq(categories.userEmail, userEmail))
      .groupBy(categories.id)
      .all();

    // 获取该组下的通知总数
    const groupNotificationCount = await this.db
      .select({ count: sql`COUNT(*)` })
      .from(pushNotifications)
      .where(
        and(
          eq(pushNotifications.userEmail, userEmail),
          eq(pushNotifications.groupId, group.id)
        )
      )
      .get();

    return [
      { id: 'all', name: 'All', count: Number(groupNotificationCount?.count || 0) },
      ...categoriesWithCount,
    ];
  }

  /**
   * 获取用户的通知总数
   * @param userEmail 用户邮箱
   * @returns 通知总数
   */
  private async getTotalNotificationCount(userEmail: string) {
    const result = await this.db
      .select({ count: sql`COUNT(*)` })
      .from(pushNotifications)
      .where(eq(pushNotifications.userEmail, userEmail))
      .get();

    return Number(result?.count || 0);
  }
} 
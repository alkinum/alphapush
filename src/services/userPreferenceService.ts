import { eq } from 'drizzle-orm';
import { userPreferences } from '@/schema';
import { getDb } from '@/db';
import type { D1Database } from '@cloudflare/workers-types';

export interface UserPreference {
  showNotificationIcons: boolean;
  barkFallbackEnabled: boolean;
  barkFallbackAlways: boolean;
  barkServerUrl: string;
  barkDeviceKey: string;
}

export const defaultPreferences: UserPreference = {
  showNotificationIcons: true,
  barkFallbackEnabled: false,
  barkFallbackAlways: false,
  barkServerUrl: 'https://api.day.app',
  barkDeviceKey: '',
};

export function mergeWithDefaultPreferences(preferences: Partial<UserPreference> | null | undefined): UserPreference {
  return {
    ...defaultPreferences,
    ...(preferences || {}),
  };
}

/**
 * UserPreferenceService for managing user preferences
 * It stores user preferences in Cloudflare KV and provides synchronization functionality
 */
export class UserPreferenceService {
  private db: ReturnType<typeof getDb>;

  constructor(d1: D1Database) {
    this.db = getDb(d1);
  }

  /**
   * Get user preferences
   * @param userEmail User email
   * @returns User preferences
   */
  async getUserPreferences(userEmail: string): Promise<UserPreference> {
    try {
      const result = await this.db.select().from(userPreferences).where(eq(userPreferences.userEmail, userEmail));

      if (!result || result.length === 0) {
        // If the user has no preferences, create default settings
        return this.createUserPreferences(userEmail, defaultPreferences);
      }

      // Parse the stored JSON string and fill fields added after the row was created.
      return mergeWithDefaultPreferences(JSON.parse(result[0].preferences) as Partial<UserPreference>);
    } catch (error) {
      console.error('Error getting user preferences:', error);
      // If an error occurs, return default settings
      return { ...defaultPreferences };
    }
  }

  /**
   * Create user preferences
   * @param userEmail User email
   * @param preferences User preferences
   * @returns Created user preferences
   */
  async createUserPreferences(userEmail: string, preferences: UserPreference): Promise<UserPreference> {
    try {
      await this.db.insert(userPreferences).values({
        userEmail,
        preferences: JSON.stringify(preferences),
      });

      return preferences;
    } catch (error) {
      console.error('Error creating user preferences:', error);
      return { ...defaultPreferences };
    }
  }

  /**
   * Update user preferences
   * @param userEmail User email
   * @param preferences User preferences to update
   * @returns Updated user preferences
   */
  async updateUserPreferences(userEmail: string, preferences: Partial<UserPreference>): Promise<UserPreference> {
    try {
      // First get current settings
      const currentPreferences = await this.getUserPreferences(userEmail);

      // Merge new settings
      const updatedPreferences = {
        ...currentPreferences,
        ...preferences,
      };

      // Update database
      await this.db.update(userPreferences)
        .set({ preferences: JSON.stringify(updatedPreferences) })
        .where(eq(userPreferences.userEmail, userEmail));

      return updatedPreferences;
    } catch (error) {
      console.error('Error updating user preferences:', error);
      return { ...defaultPreferences };
    }
  }

  /**
   * Sync a single preference
   * @param userEmail User email
   * @param key Preference key
   * @param value Preference value
   * @returns Updated user preferences
   */
  async syncPreference<K extends keyof UserPreference>(
    userEmail: string,
    key: K,
    value: UserPreference[K]
  ): Promise<UserPreference> {
    return this.updateUserPreferences(userEmail, { [key]: value } as Partial<UserPreference>);
  }

  /**
   * Static method to create an instance with the database
   * @param d1 D1Database instance
   * @returns UserPreferenceService instance
   */
  static create(d1: D1Database): UserPreferenceService {
    return new UserPreferenceService(d1);
  }
}

// Create a helper for client-side use, combining local storage and remote sync
export const userPreferenceManager = {
  // Instance of the service, to be initialized
  service: null as UserPreferenceService | null,

  /**
   * Initialize the service with a database instance
   * @param d1 D1Database instance
   */
  init(d1: D1Database): void {
    this.service = new UserPreferenceService(d1);
  },

  /**
   * Get user preferences, prioritizing local storage
   * @param userEmail User email
   * @returns User preferences
   */
  async getPreferences(userEmail: string): Promise<UserPreference> {
    // Try to get from local storage
    const localPrefs = this.getLocalPreferences();

    // If there's data in local storage, use it
    if (localPrefs) {
      return localPrefs;
    }

    // Otherwise get from server if service is available
    if (this.service) {
      const remotePrefs = await this.service.getUserPreferences(userEmail);

      // Save server data to local storage
      this.saveLocalPreferences(remotePrefs);

      return remotePrefs;
    }

    // If service is not available, return default preferences
    return { ...defaultPreferences };
  },

  /**
   * Update user preferences, updating both local storage and remote server
   * @param userEmail User email
   * @param preferences User preferences to update
   * @returns Updated user preferences
   */
  async updatePreferences(userEmail: string, preferences: Partial<UserPreference>): Promise<UserPreference> {
    // First update local storage
    const currentPrefs = this.getLocalPreferences() || { ...defaultPreferences };
    const updatedPrefs = mergeWithDefaultPreferences({ ...currentPrefs, ...preferences });
    this.saveLocalPreferences(updatedPrefs);

    // Then asynchronously update server if service is available
    if (this.service) {
      try {
        return await this.service.updateUserPreferences(userEmail, preferences);
      } catch (error) {
        console.error('Error updating remote preferences:', error);
      }
    }

    return updatedPrefs;
  },

  /**
   * Sync a single preference
   * @param userEmail User email
   * @param key Preference key
   * @param value Preference value
   * @returns Updated user preferences
   */
  async syncPreference<K extends keyof UserPreference>(
    userEmail: string,
    key: K,
    value: UserPreference[K]
  ): Promise<UserPreference> {
    // First update local storage
    const currentPrefs = this.getLocalPreferences() || { ...defaultPreferences };
    currentPrefs[key] = value;
    this.saveLocalPreferences(currentPrefs);

    // Then asynchronously update server if service is available
    if (this.service) {
      try {
        return await this.service.syncPreference(userEmail, key, value);
      } catch (error) {
        console.error(`Error syncing preference ${String(key)}:`, error);
      }
    }

    return currentPrefs;
  },

  /**
   * Get user preferences from local storage
   * @returns User preferences or null
   */
  getLocalPreferences(): UserPreference | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    try {
      const prefsString = localStorage.getItem('userPreferences');
      if (!prefsString) {
        return null;
      }

      return mergeWithDefaultPreferences(JSON.parse(prefsString) as Partial<UserPreference>);
    } catch (error) {
      console.error('Error parsing local preferences:', error);
      return null;
    }
  },

  /**
   * Save user preferences to local storage
   * @param preferences User preferences
   */
  saveLocalPreferences(preferences: UserPreference): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    try {
      localStorage.setItem('userPreferences', JSON.stringify(preferences));
    } catch (error) {
      console.error('Error saving local preferences:', error);
    }
  },

  /**
   * Get a single preference, prioritizing local storage
   * @param key Preference key
   * @param defaultValue Default value
   * @returns Preference value
   */
  getPreference<K extends keyof UserPreference>(key: K, defaultValue?: UserPreference[K]): UserPreference[K] {
    if (typeof localStorage === 'undefined') {
      return defaultValue !== undefined ? defaultValue : defaultPreferences[key];
    }

    try {
      const prefs = this.getLocalPreferences();
      if (!prefs) {
        return defaultValue !== undefined ? defaultValue : defaultPreferences[key];
      }

      return prefs[key] !== undefined ? prefs[key] : (defaultValue !== undefined ? defaultValue : defaultPreferences[key]);
    } catch (error) {
      console.error(`Error getting preference ${String(key)}:`, error);
      return defaultValue !== undefined ? defaultValue : defaultPreferences[key];
    }
  }
};

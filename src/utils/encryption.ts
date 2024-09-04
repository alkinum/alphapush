const MASTER_KEY_STORAGE_KEY = 'masterKey';
const DB_NAME = 'encryptionDB';
const STORE_NAME = 'keyStore';
const DB_VERSION = 1;

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      db.createObjectStore(STORE_NAME);
    };
  });
}

export async function setMasterKey(key: string | null): Promise<void> {
  if (key) {
    localStorage.setItem(MASTER_KEY_STORAGE_KEY, key);
    const db = await openDatabase();
    const transaction = db.transaction(STORE_NAME, 'readwrite');
    const store = transaction.objectStore(STORE_NAME);
    await new Promise<void>((resolve, reject) => {
      const request = store.put(key, MASTER_KEY_STORAGE_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve();
    });
  } else {
    localStorage.removeItem(MASTER_KEY_STORAGE_KEY);

    try {
      const db = await openDatabase();
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        console.log('Object store not found, skipping deletion');
        return;
      }

      const transaction = db.transaction(STORE_NAME, 'readwrite');
      const store = transaction.objectStore(STORE_NAME);

      const existingKey = await new Promise<string | undefined>((resolve, reject) => {
        const request = store.get(MASTER_KEY_STORAGE_KEY);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve(request.result);
      });

      if (existingKey === undefined) {
        console.log('No existing master key found, skipping deletion');
        return;
      }

      await new Promise<void>((resolve, reject) => {
        const request = store.delete(MASTER_KEY_STORAGE_KEY);
        request.onerror = () => reject(request.error);
        request.onsuccess = () => resolve();
      });

      console.log('Master key successfully deleted');
    } catch (error) {
      console.error('Error while attempting to delete master key:', error);
    }
  }

  // Trigger custom event
  const event = new CustomEvent('masterKeyChanged', { detail: { key } });
  document.dispatchEvent(event);
}

export async function getMasterKey(): Promise<string> {
  const localStorageKey = localStorage.getItem(MASTER_KEY_STORAGE_KEY);
  if (localStorageKey) {
    return localStorageKey;
  }

  try {
    const db = await openDatabase();
    if (!db.objectStoreNames.contains(STORE_NAME)) {
      console.log('Object store not found, returning empty string');
      return '';
    }

    const transaction = db.transaction(STORE_NAME, 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    const result = await new Promise<string | undefined>((resolve, reject) => {
      const request = store.get(MASTER_KEY_STORAGE_KEY);
      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);
    });

    if (result === undefined) {
      console.log('No existing master key found, returning empty string');
      return '';
    }

    return result;
  } catch (error) {
    console.error('Error while attempting to get master key:', error);
    return '';
  }
}

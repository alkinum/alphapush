import FingerprintJS from '@fingerprintjs/fingerprintjs';

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

async function getStoredFingerprint(): Promise<string | null> {
  const storedFingerprint = localStorage.getItem('deviceFingerprint');
  if (storedFingerprint) {
    return storedFingerprint;
  }

  return new Promise((resolve) => {
    const request = indexedDB.open('FingerprintDB', 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      db.createObjectStore('fingerprints', { keyPath: 'id' });
    };
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('fingerprints', 'readonly');
      const store = transaction.objectStore('fingerprints');
      const getRequest = store.get('deviceFingerprint');
      getRequest.onsuccess = () => {
        resolve(getRequest.result ? getRequest.result.value : null);
      };
      getRequest.onerror = () => resolve(null);
    };
    request.onerror = () => resolve(null);
  });
}

async function storeFingerprint(fingerprint: string): Promise<void> {
  localStorage.setItem('deviceFingerprint', fingerprint);

  return new Promise((resolve) => {
    const request = indexedDB.open('FingerprintDB', 1);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction('fingerprints', 'readwrite');
      const store = transaction.objectStore('fingerprints');
      store.put({ id: 'deviceFingerprint', value: fingerprint });
      transaction.oncomplete = () => resolve();
    };
    request.onerror = () => resolve();
  });
}

async function generateFingerprint(): Promise<string> {
  const storedFingerprint = await getStoredFingerprint();
  if (storedFingerprint) {
    return storedFingerprint;
  }

  const fp = await FingerprintJS.load();
  const result = await fp.get();
  const fingerprint = await sha256(result.visitorId);
  await storeFingerprint(fingerprint);
  return fingerprint;
}

async function getCombinedFingerprint(email: string): Promise<string> {
  const rawFingerprint = await generateFingerprint();
  const combinedString = `${rawFingerprint}:${email}`;
  return sha256(combinedString);
}

export { generateFingerprint, getCombinedFingerprint };

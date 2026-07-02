const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 128;
const KEY_CACHE_MAX_SIZE = 100;
const KEY_CACHE_TTL_MS = 1000 * 60 * 60;

const keyCache = new Map<string, { expiresAt: number; value: CryptoKey }>();

function getCachedKey(cacheKey: string): CryptoKey | undefined {
  const cached = keyCache.get(cacheKey);

  if (!cached) {
    return undefined;
  }

  if (cached.expiresAt <= Date.now()) {
    keyCache.delete(cacheKey);
    return undefined;
  }

  keyCache.delete(cacheKey);
  keyCache.set(cacheKey, cached);
  return cached.value;
}

function setCachedKey(cacheKey: string, value: CryptoKey): void {
  if (keyCache.has(cacheKey)) {
    keyCache.delete(cacheKey);
  } else if (keyCache.size >= KEY_CACHE_MAX_SIZE) {
    const oldestKey = keyCache.keys().next().value;
    if (oldestKey) {
      keyCache.delete(oldestKey);
    }
  }

  keyCache.set(cacheKey, {
    expiresAt: Date.now() + KEY_CACHE_TTL_MS,
    value,
  });
}

// Add these utility functions for base64 encoding/decoding
function base64ToUint8Array(base64: string): Uint8Array {
  const binaryString = atob(base64);
  const len = binaryString.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

function uint8ArrayToBase64(array: Uint8Array): string {
  return btoa(String.fromCharCode.apply(null, array as unknown as number[]));
}

export async function encrypt(
  message: string,
  masterKey: string,
): Promise<{ encryptedContent: string; nonce: string }> {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);

  // Generate a random nonce
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_LENGTH));

  // Derive a key from the master key and nonce
  const derivedKey = await deriveKey(masterKey, nonce);

  // Encrypt the data
  const encryptedData = await crypto.subtle.encrypt(
    { name: ALGORITHM, iv: nonce, tagLength: TAG_LENGTH },
    derivedKey,
    data,
  );

  // Replace Buffer usage with the new utility function
  const encryptedContent = uint8ArrayToBase64(new Uint8Array(encryptedData));
  const nonceBase64 = uint8ArrayToBase64(nonce);

  return { encryptedContent, nonce: nonceBase64 };
}

export async function decrypt(encryptedContent: string, masterKey: string, nonce: string): Promise<string> {
  // Replace Buffer usage with the new utility function
  const encryptedData = base64ToUint8Array(encryptedContent);
  const nonceBuffer = base64ToUint8Array(nonce);

  // Derive the key from the master key and nonce
  const derivedKey = await deriveKey(masterKey, nonceBuffer);

  // Decrypt the data
  const decryptedData = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: nonceBuffer as BufferSource, tagLength: TAG_LENGTH },
    derivedKey,
    encryptedData as BufferSource,
  );

  // Decode the decrypted data to a string
  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

async function deriveKey(masterKey: string, salt: Uint8Array): Promise<CryptoKey> {
  // Replace Buffer usage with the new utility function
  const cacheKey = `${masterKey}:${uint8ArrayToBase64(salt)}`;
  const cachedKey = getCachedKey(cacheKey);

  if (cachedKey) {
    return cachedKey;
  }

  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey('raw', encoder.encode(masterKey), { name: 'PBKDF2' }, false, [
    'deriveKey',
  ]);

  const derivedKey = await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'] as KeyUsage[],
  );

  setCachedKey(cacheKey, derivedKey);
  return derivedKey;
}

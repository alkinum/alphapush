import { Buffer } from 'node:buffer';
import LRUCache from 'lru-cache';

const ALGORITHM = 'AES-GCM';
const KEY_LENGTH = 256;
const NONCE_LENGTH = 12;
const TAG_LENGTH = 128;

// Create an LRU cache for derived keys
const keyCache = new LRUCache<string, CryptoKey>({
  max: 100,
  ttl: 1000 * 60 * 60,
});

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

  // Encode the encrypted data and nonce to base64
  const encryptedContent = Buffer.from(encryptedData).toString('base64');
  const nonceBase64 = Buffer.from(nonce).toString('base64');

  return { encryptedContent, nonce: nonceBase64 };
}

export async function decrypt(encryptedContent: string, masterKey: string, nonce: string): Promise<string> {
  // Decode the encrypted content and nonce from base64
  const encryptedData = Buffer.from(encryptedContent, 'base64');
  const nonceBuffer = Buffer.from(nonce, 'base64');

  // Derive the key from the master key and nonce
  const derivedKey = await deriveKey(masterKey, nonceBuffer);

  // Decrypt the data
  const decryptedData = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: nonceBuffer, tagLength: TAG_LENGTH },
    derivedKey,
    encryptedData,
  );

  // Decode the decrypted data to a string
  const decoder = new TextDecoder();
  return decoder.decode(decryptedData);
}

async function deriveKey(masterKey: string, salt: Uint8Array): Promise<CryptoKey> {
  const cacheKey = `${masterKey}:${Buffer.from(salt).toString('base64')}`;
  const cachedKey = keyCache.get(cacheKey);

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
      salt,
      iterations: 10000,
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: ALGORITHM, length: KEY_LENGTH },
    false,
    ['encrypt', 'decrypt'],
  );

  keyCache.set(cacheKey, derivedKey);
  return derivedKey;
}

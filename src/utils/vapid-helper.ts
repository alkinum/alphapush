import { customAlphabet } from 'nanoid';
import { encodeBase64Url } from './base64';

interface UserCredentials {
  publicKey: string;
  privateKey: string;
  pushToken: string;
}

const generateToken = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 16);

async function generateVAPIDKeys() {
  const keyPair = await crypto.subtle.generateKey(
    {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    true,
    ['sign', 'verify'],
  );

  const publicKey = await crypto.subtle.exportKey('raw', keyPair.publicKey);
  const privateKey = await crypto.subtle.exportKey('jwk', keyPair.privateKey);

  return {
    publicKey: encodeBase64Url(publicKey),
    privateKey: privateKey.d ?? '',
  };
}

async function generateUserCredentials(): Promise<UserCredentials> {
  return {
    ...(await generateVAPIDKeys()),
    pushToken: generatePushToken(),
  };
}

function generatePushToken(): string {
  return generateToken();
}

export { generateUserCredentials, generatePushToken };
export type { UserCredentials };

import { customAlphabet } from 'nanoid';
import crypto from 'node:crypto';

interface UserCredentials {
  publicKey: string;
  privateKey: string;
  pushToken: string;
}

const generateToken = customAlphabet('ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 16);

function generateVAPIDKeys() {
  const curve = crypto.createECDH('prime256v1');
  curve.generateKeys();

  let publicKeyBuffer = curve.getPublicKey();
  let privateKeyBuffer = curve.getPrivateKey();

  // Occassionally the keys will not be padded to the correct lengh resulting
  // in errors, hence this padding.
  // See https://github.com/web-push-libs/web-push/issues/295 for history.
  if (privateKeyBuffer.length < 32) {
    const padding = Buffer.alloc(32 - privateKeyBuffer.length);
    padding.fill(0);
    privateKeyBuffer = Buffer.concat([padding, privateKeyBuffer]);
  }

  if (publicKeyBuffer.length < 65) {
    const padding = Buffer.alloc(65 - publicKeyBuffer.length);
    padding.fill(0);
    publicKeyBuffer = Buffer.concat([padding, publicKeyBuffer]);
  }

  return {
    publicKey: publicKeyBuffer.toString('base64url'),
    privateKey: privateKeyBuffer.toString('base64url'),
  };
}

async function generateUserCredentials(): Promise<UserCredentials> {
  return {
    ...generateVAPIDKeys(),
    pushToken: generatePushToken(),
  };
}

function generatePushToken(): string {
  return generateToken();
}

export { generateUserCredentials, generatePushToken };
export type { UserCredentials };

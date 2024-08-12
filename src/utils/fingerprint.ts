import FingerprintJS from '@fingerprintjs/fingerprintjs';

async function sha256(message: string): Promise<string> {
  const msgBuffer = new TextEncoder().encode(message);
  const hashBuffer = await crypto.subtle.digest('SHA-256', msgBuffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

async function generateFingerprint() {
  const fp = await FingerprintJS.load();
  const result = await fp.get();
  return sha256(result.visitorId);
}

async function getCombinedFingerprint(email: string): Promise<string> {
  const rawFingerprint = await generateFingerprint();
  const combinedString = `${rawFingerprint}:${email}`;
  return sha256(combinedString);
}

export { generateFingerprint, getCombinedFingerprint };

import { config } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { encrypt } from '@alkinum/alphapush-encryption';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

config({ path: resolve(__dirname, '.env') });

const API_TARGET = 'http://localhost:4321/api/push';
const PUSH_TOKEN = process.env.PUSH_TOKEN;
const MASTER_KEY = process.env.MASTER_KEY;

async function sendEncryptedNotification(message) {
  try {
    if (!PUSH_TOKEN || !MASTER_KEY) {
      throw new Error('PUSH_TOKEN and MASTER_KEY must be set in the .env file');
    }

    const { encryptedContent, nonce } = await encrypt(message, MASTER_KEY);

    const notificationContent = `---
title: Encrypted Notification
type: encrypted
extra:
  nonce: ${nonce}
---
${encryptedContent}`;

    const response = await fetch(API_TARGET, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        pushToken: PUSH_TOKEN,
        content: notificationContent,
      }),
    });

    const responseBody = await response.text();
    console.log('Response status:', response.status);
    console.log('Response body:', responseBody);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}, body: ${responseBody}`);
    }

    console.log('Notification sent successfully');
  } catch (error) {
    console.error('Error sending encrypted notification:', error);
  }
}

sendEncryptedNotification('This is a secret message!');

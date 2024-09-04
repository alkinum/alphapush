# Encryption

End to end encryption helpers for AlphaPush.

## Usage

This encryption module provides two main functions: `encrypt` and `decrypt`. These functions use AES-GCM algorithm for encryption and decryption, with a key derivation process to enhance security.

### Encrypt

To encrypt a message:

```typescript
import { encrypt } from '@alphapush/encryption';

const message = 'Hello, World!';
const masterKey = 'your-secret-master-key';

const { encryptedContent, nonce } = await encrypt(message, masterKey);
console.log('Encrypted content:', encryptedContent);
console.log('Nonce:', nonce);
```

The `encrypt` function returns an object containing the encrypted content and a nonce. Both are encoded as base64 strings.

### Decrypt

To decrypt an encrypted message:

```typescript
import { decrypt } from '@alphapush/encryption';

const encryptedContent = 'base64-encoded-encrypted-content';
const masterKey = 'your-secret-master-key';
const nonce = 'base64-encoded-nonce';

const decryptedMessage = await decrypt(encryptedContent, masterKey, nonce);
console.log('Decrypted message:', decryptedMessage);
```

### Important Notes

1. The `masterKey` should be a secure, randomly generated string. It's crucial to keep this key secret and secure.
2. The `nonce` is generated for each encryption operation and is required for decryption. It's safe to store or transmit alongside the encrypted content.
3. This module uses the Web Crypto API, which is available in modern browsers and Node.js environments.
4. The encryption uses AES-GCM with a 256-bit key length, providing strong security for most use cases.

### Error Handling

Both `encrypt` and `decrypt` functions are asynchronous and may throw errors. It's recommended to use try-catch blocks when calling these functions:

```typescript
try {
  const result = await encrypt(message, masterKey);
  // Handle successful encryption
} catch (error) {
  console.error('Encryption failed:', error);
  // Handle encryption error
}
```

## Security Considerations

- Always use a strong, unique master key for each application or user.
- Never hardcode the master key in your source code.
- Implement proper key management practices, such as secure key storage and rotation.
- Be cautious when transmitting or storing the encrypted content and nonce together, as both are required for decryption.

## Other Language Implementations

For developers working in other languages, we provide equivalent implementations of this encryption module:

- [Go Implementation](src/docs/go.md)
- [Python Implementation](src/docs/python.md)

These implementations follow the same encryption principles and can be used interchangeably with the TypeScript version.

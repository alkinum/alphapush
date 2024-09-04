# Python Encryption Implementation

This document describes how to implement the same encryption and decryption process in Python, matching the TypeScript implementation in the AlphaPush encryption package.

## Requirements

- Python 3.6+
- `pycryptodome` library

Install the required library using pip:

```
pip install pycryptodome
```

## Implementation

```python
import os
from base64 import b64encode, b64decode
from Crypto.Cipher import AES
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Hash import SHA256

ALGORITHM = 'AES'
KEY_LENGTH = 32  # 256 bits
NONCE_LENGTH = 12
TAG_LENGTH = 16  # 128 bits

def derive_key(master_key: str, salt: bytes) -> bytes:
    return PBKDF2(master_key, salt, dkLen=KEY_LENGTH, count=10000, hmac_hash_module=SHA256)

def encrypt(message: str, master_key: str) -> dict:
    # Generate a random nonce
    nonce = os.urandom(NONCE_LENGTH)

    # Derive a key from the master key and nonce
    derived_key = derive_key(master_key, nonce)

    # Create cipher and encrypt
    cipher = AES.new(derived_key, AES.MODE_GCM, nonce=nonce)
    ciphertext, tag = cipher.encrypt_and_digest(message.encode('utf-8'))

    # Encode the encrypted data and nonce to base64
    encrypted_content = b64encode(ciphertext + tag).decode('utf-8')
    nonce_base64 = b64encode(nonce).decode('utf-8')

    return {'encryptedContent': encrypted_content, 'nonce': nonce_base64}

def decrypt(encrypted_content: str, master_key: str, nonce: str) -> str:
    # Decode the encrypted content and nonce from base64
    encrypted_data = b64decode(encrypted_content)
    nonce_buffer = b64decode(nonce)

    # Derive the key from the master key and nonce
    derived_key = derive_key(master_key, nonce_buffer)

    # Split ciphertext and tag
    ciphertext, tag = encrypted_data[:-TAG_LENGTH], encrypted_data[-TAG_LENGTH:]

    # Create cipher and decrypt
    cipher = AES.new(derived_key, AES.MODE_GCM, nonce=nonce_buffer)
    decrypted_data = cipher.decrypt_and_verify(ciphertext, tag)

    return decrypted_data.decode('utf-8')

# Usage example
if __name__ == "__main__":
    message = "Hello, World!"
    master_key = "your-secret-master-key"

    # Encrypt
    encrypted = encrypt(message, master_key)
    print("Encrypted:", encrypted)

    # Decrypt
    decrypted = decrypt(encrypted['encryptedContent'], master_key, encrypted['nonce'])
    print("Decrypted:", decrypted)
```

This Python implementation closely mirrors the TypeScript version, using the same encryption algorithm (AES-GCM), key derivation method (PBKDF2), and overall structure.

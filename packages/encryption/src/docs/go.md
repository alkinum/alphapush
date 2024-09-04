# Go Encryption Implementation

This document describes how to implement the same encryption and decryption process in Go, matching the TypeScript implementation in the AlphaPush encryption package.

## Requirements

- Go 1.16+

No additional libraries are required as Go's standard library provides all necessary cryptographic functions.

## Implementation

```go
package main

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"fmt"
	"golang.org/x/crypto/pbkdf2"
)

const (
	keyLength   = 32 // 256 bits
	nonceLength = 12
	iterations  = 10000
)

func deriveKey(masterKey string, salt []byte) []byte {
	return pbkdf2.Key([]byte(masterKey), salt, iterations, keyLength, sha256.New)
}

func encrypt(message, masterKey string) (map[string]string, error) {
	// Generate a random nonce
	nonce := make([]byte, nonceLength)
	if _, err := rand.Read(nonce); err != nil {
		return nil, err
	}

	// Derive a key from the master key and nonce
	derivedKey := deriveKey(masterKey, nonce)

	// Create cipher and encrypt
	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return nil, err
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}

	ciphertext := aesgcm.Seal(nil, nonce, []byte(message), nil)

	// Encode the encrypted data and nonce to base64
	encryptedContent := base64.StdEncoding.EncodeToString(ciphertext)
	nonceBase64 := base64.StdEncoding.EncodeToString(nonce)

	return map[string]string{
		"encryptedContent": encryptedContent,
		"nonce":            nonceBase64,
	}, nil
}

func decrypt(encryptedContent, masterKey, nonce string) (string, error) {
	// Decode the encrypted content and nonce from base64
	ciphertext, err := base64.StdEncoding.DecodeString(encryptedContent)
	if err != nil {
		return "", err
	}

	nonceBuffer, err := base64.StdEncoding.DecodeString(nonce)
	if err != nil {
		return "", err
	}

	// Derive the key from the master key and nonce
	derivedKey := deriveKey(masterKey, nonceBuffer)

	// Create cipher and decrypt
	block, err := aes.NewCipher(derivedKey)
	if err != nil {
		return "", err
	}

	aesgcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	plaintext, err := aesgcm.Open(nil, nonceBuffer, ciphertext, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}

func main() {
	message := "Hello, World!"
	masterKey := "your-secret-master-key"

	// Encrypt
	encrypted, err := encrypt(message, masterKey)
	if err != nil {
		fmt.Printf("Encryption error: %v\n", err)
		return
	}
	fmt.Printf("Encrypted: %v\n", encrypted)

	// Decrypt
	decrypted, err := decrypt(encrypted["encryptedContent"], masterKey, encrypted["nonce"])
	if err != nil {
		fmt.Printf("Decryption error: %v\n", err)
		return
	}
	fmt.Printf("Decrypted: %s\n", decrypted)
}
```

This Go implementation closely mirrors the TypeScript version, using the same encryption algorithm (AES-GCM), key derivation method (PBKDF2), and overall structure.

Remember to handle the master key securely and never hardcode it in your source code. Always use strong, unique keys for each application or user.

To use this code, save it in a `.go` file and run it with `go run filename.go`. Make sure to handle errors appropriately in a production environment.

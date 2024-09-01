import { decode as decodeBase64, encode as encodeBase64 } from 'base64-arraybuffer';

export function decodeBase64Url(str: string): ArrayBuffer {
  return decodeBase64(str.replace(/-/g, '+').replace(/_/g, '/'));
}

export function encodeBase64Url(arr: ArrayBuffer): string {
  return encodeBase64(arr).replace(/\//g, '_').replace(/\+/g, '-').replace(/=+$/, '');
}

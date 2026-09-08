/** Checks literal local addresses and local hostnames after URL normalization. */
export function isLocalNetworkUrl(url: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return false;
  }

  if (hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
    return true;
  }

  if (/^(\d{1,3}\.){3}\d{1,3}$/.test(hostname)) {
    return isLocalIPv4(hostname.split('.').map(Number));
  }

  // URL.hostname includes brackets and compresses IPv6, including mapped IPv4.
  if (!hostname.startsWith('[')) return false;
  const address = hostname.slice(1, -1);
  const [left, right] = address.split('::');
  const head = left ? left.split(':') : [];
  const tail = right ? right.split(':') : [];
  const words = (right === undefined
    ? head
    : [...head, ...Array(8 - head.length - tail.length).fill('0'), ...tail])
    .map(word => Number.parseInt(word, 16));

  if (words.every(word => word === 0) || (words.slice(0, 7).every(word => word === 0) && words[7] === 1)) {
    return true;
  }

  if ((words[0] & 0xfe00) === 0xfc00 || (words[0] & 0xffc0) === 0xfe80) {
    return true;
  }

  if (words.slice(0, 5).every(word => word === 0) && (words[5] === 0xffff || words[5] === 0)) {
    return isLocalIPv4([words[6] >> 8, words[6] & 255, words[7] >> 8, words[7] & 255]);
  }

  return false;
}

function isLocalIPv4([first, second]: number[]): boolean {
  return first === 0 || first === 10 || first === 127 ||
    (first === 100 && second >= 64 && second <= 127) ||
    (first === 169 && second === 254) ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168);
}

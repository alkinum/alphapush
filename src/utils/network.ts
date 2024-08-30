/**
 * Checks if a given URL is a local network URL.
 * @param url The URL to check
 * @returns True if the URL is a local network URL, false otherwise
 */
export function isLocalNetworkUrl(url: string): boolean {
  try {
    const parsedUrl = new URL(url);
    const hostname = parsedUrl.hostname;

    if (!hostname) {
      return false;
    }

    // Check for localhost
    if (/^localhost$/i.test(hostname)) {
      return true;
    }

    // Check for IP addresses
    if (isIPAddress(hostname)) {
      const ipParts = hostname.split('.');

      // Check for private IPv4 ranges
      if (
        ipParts[0] === '10' ||
        (ipParts[0] === '172' && parseInt(ipParts[1]) >= 16 && parseInt(ipParts[1]) <= 31) ||
        (ipParts[0] === '192' && ipParts[1] === '168')
      ) {
        return true;
      }

      // Check for loopback IPv4
      if (ipParts[0] === '127') {
        return true;
      }

      // Check for link-local IPv4
      if (ipParts[0] === '169' && ipParts[1] === '254') {
        return true;
      }

      // Check for IPv6 localhost
      if (hostname === '::1') {
        return true;
      }

      // Check for IPv6 unique local addresses
      if (hostname.toLowerCase().startsWith('fc') || hostname.toLowerCase().startsWith('fd')) {
        return true;
      }

      // Check for IPv6 link-local addresses
      if (hostname.toLowerCase().startsWith('fe80:')) {
        return true;
      }
    }

    return false;
  } catch (error) {
    console.error('Error parsing URL:', error);
    return false;
  }
}

/**
 * Simple function to check if a string is an IP address
 * @param str The string to check
 * @returns True if the string is an IP address, false otherwise
 */
function isIPAddress(str: string): boolean {
  // IPv4
  const ipv4Pattern = /^(\d{1,3}\.){3}\d{1,3}$/;
  // IPv6
  const ipv6Pattern = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;

  return ipv4Pattern.test(str) || ipv6Pattern.test(str);
}

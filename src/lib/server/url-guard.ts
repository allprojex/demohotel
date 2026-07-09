/**
 * SSRF guard for user-supplied outbound URLs (webhooks, callbacks, etc.).
 * Rejects non-http(s) schemes and private / loopback / link-local hosts.
 */
const BLOCKED_HOST_RE =
  /^(localhost|0(\.|$)|127\.|10\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|::1$|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe80:|metadata\.google\.internal$)/i;

export function assertSafeOutboundUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error("Webhook URL is not a valid URL");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("Webhook URL must use http(s)");
  }
  const host = url.hostname.replace(/\[|\]/g, "");
  if (!host) throw new Error("Webhook URL has no host");
  if (BLOCKED_HOST_RE.test(host)) {
    throw new Error("Webhook URL must be a public address (private/loopback/metadata hosts are blocked)");
  }
  // Additionally block IPv4 in 0.0.0.0/8 explicitly.
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a] = host.split(".").map(Number);
    if (a === 0) throw new Error("Webhook URL must be a public address");
  }
  return url;
}

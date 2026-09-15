/**
 * Shared endpoint security validation for outbound LLM/provider requests.
 *
 * Any endpoint that receives an API key must use HTTPS — plaintext HTTP
 * would expose the key to anyone on the network path. This check is
 * intentionally strict: even localhost must use HTTPS (consistent with
 * the existing adapter behavior).
 *
 * The error message deliberately does NOT include the URL — endpoints
 * may be user-supplied and sensitive.
 */
export function assertHttpsEndpoint(url: string): void {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new Error('Endpoint must be a valid URL')
  }
  // Protocol comparison is case-insensitive by spec; `new URL` normalizes it,
  // so "HTTP://..." can no longer slip past a lowercase startsWith check.
  if (parsed.protocol !== 'https:') {
    throw new Error('Endpoint must use HTTPS')
  }
}

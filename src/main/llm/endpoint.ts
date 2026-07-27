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
  if (url.startsWith('http://')) {
    throw new Error('Endpoint must use HTTPS')
  }
}

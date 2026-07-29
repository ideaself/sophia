/**
 * True when a node fs error means "path does not exist" (ENOENT).
 *
 * Read paths in the storage layer treat a missing file as "no data yet" and
 * return null/[]. That is only legitimate for ENOENT — permission errors,
 * corrupt JSON, or schema mismatches are a different story and must at
 * least be logged, otherwise data corruption presents as "data vanished".
 */
export function isNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT'
}

/** Log a non-ENOENT read failure before falling back to a default value. */
export function warnReadFailure(what: string, err: unknown): void {
  console.warn(`[storage] Failed to read ${what}:`, err)
}

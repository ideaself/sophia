import { resolve } from 'node:path'

/**
 * Tracks absolute file paths the user explicitly picked through the native
 * open-file dialog. IPC handlers that read renderer-supplied paths from disk
 * (e.g. `textbook:create` parsing a PDF/EPUB) must only accept paths present
 * in this registry — otherwise a compromised renderer could read arbitrary
 * files from the user's machine.
 */
export class PickedFileRegistry {
  private readonly paths = new Set<string>()

  private normalize(filePath: string): string {
    return resolve(filePath)
  }

  /** Register a path returned by dialog.showOpenDialog. */
  add(filePath: string): void {
    this.paths.add(this.normalize(filePath))
  }

  /** True only for paths previously registered via add(). */
  has(filePath: string): boolean {
    return this.paths.has(this.normalize(filePath))
  }
}

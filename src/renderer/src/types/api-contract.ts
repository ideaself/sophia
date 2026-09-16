/**
 * Compile-time contract between the renderer's declared `window.sophia` API
 * and the preload implementation's API surface.
 *
 * The two type sets live in different TS projects (node vs web) and both are
 * declared inside `declare global` blocks in .d.ts files — which
 * `skipLibCheck` exempts from checking. Without this file, editing one side
 * (e.g. adding a method to the preload DataAPI) compiles silently while the
 * renderer keeps an outdated view of the API.
 *
 * The bidirectional assignments below are the guard: any structural
 * difference fails `npm run typecheck:web` with a readable error.
 *
 * This file contains no runtime code and is not imported by the app.
 */

type PreloadSophiaAPI = import('../../../preload/index').SophiaAPI

// Global `SophiaAPI` here is the renderer-side declaration (global.d.ts).
declare const rendererAPI: SophiaAPI
declare const preloadAPI: PreloadSophiaAPI

// Renderer must not declare APIs the preload does not implement…
const _rendererMatchesPreload: PreloadSophiaAPI = rendererAPI
// …and every implemented API must be declared for the renderer.
const _preloadMatchesRenderer: SophiaAPI = preloadAPI

void _rendererMatchesPreload
void _preloadMatchesRenderer

export {}

import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // .tsx test files opt into jsdom per-file via @vitest-environment.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    globals: false,
    // Vitest 5 defaults to clearMocks: true; several suites (preload bridge,
    // app bootstrap) assert on calls recorded at module-load time, so keep the
    // pre-Vitest-5 behavior of explicit per-file mock clearing.
    clearMocks: false,
    coverage: {
      provider: 'v8',
      // `include` counts every source file, not just the ones a test happened
      // to import — otherwise untested modules are invisible and the reported
      // percentage is systematically inflated.
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.d.ts',
        'src/renderer/src/types/**',
        'src/renderer/src/main.tsx',
        'src/**/*.config.*'
      ],
      reporter: ['text', 'html', 'lcov'],
      // Conservative floors just below the current measured baseline.
      // Raise as coverage actually improves — never lower them to unblock
      // a build.
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
})

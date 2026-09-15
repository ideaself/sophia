import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: false,
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
      // Conservative floors just below the current measured baseline
      // (renderer components have no jsdom tests yet). Raise as coverage
      // actually improves — never lower them to unblock a build.
      thresholds: {
        statements: 25,
        branches: 18,
        functions: 19,
        lines: 26
      }
    }
  }
})

import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'

export default tseslint.config(
  { ignores: ['out', 'release', 'node_modules', 'dist', '*.config.ts', '*.config.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // This block deliberately does NOT grant browser globals: main/preload/
    // shared must run in Node. Any stray `window`/`document` reference in
    // those folders fails no-undef here (and tsc's node lib would also reject
    // it). The renderer overrides below add the browser environment.
    files: ['src/**/*.{ts,tsx}', 'tests/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        // Browser frame API used by the shared frame coalescer (guarded by
        // typeof at runtime so Node without a DOM never touches it).
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly'
      },
      parserOptions: {
        // Type-aware linting: catches floating promises / await misuse that
        // plain syntax rules cannot see. Both projects are listed explicitly
        // (instead of projectService) so every file — including declaration
        // files like src/preload/index.d.ts — resolves to a real program.
        project: ['./tsconfig.node.json', './tsconfig.web.json'],
        tsconfigRootDir: import.meta.dirname
      }
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh
    },
    rules: {
      // Classic hooks rules only — react-hooks v7's `recommended` preset also
      // bundles React-Compiler lint rules (set-state-in-effect, purity, ...)
      // that are too strict for the existing codebase.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }
      ],
      // Async hazards that plain rules miss. `void promise` stays allowed as
      // the explicit opt-out; JSX async handlers are exempted (React ignores
      // their return value, and wrapping every onClick in void hurts
      // readability without changing behaviour).
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': [
        'error',
        { checksVoidReturn: { attributes: false } }
      ],
      '@typescript-eslint/await-thenable': 'error'
    }
  },
  {
    // Main and preload run in Node only.
    files: ['src/main/**/*.ts', 'src/preload/**/*.ts'],
    rules: {
      // Main bundles are compiled to CJS (vite externalizeDepsPlugin), so
      // `require` / `require.resolve` are legitimate there.
      '@typescript-eslint/no-require-imports': 'off'
    }
  },
  {
    // Renderer source runs in the browser.
    files: ['src/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser
      }
    }
  },
  {
    // Renderer tests run under jsdom (browser globals) but may also poke
    // Node-only APIs (process, timers) in helpers.
    files: ['tests/renderer/**/*.{ts,tsx}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node
      }
    }
  },
  {
    // Standalone node scripts outside src (build tooling, security checks).
    files: ['scripts/**/*.mjs', 'build/**/*.cjs'],
    languageOptions: {
      globals: globals.node
    },
    rules: {
      '@typescript-eslint/no-require-imports': 'off'
    }
  }
)

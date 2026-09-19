import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'

export default defineConfig({
  build: {
    outDir: 'dist',
  },
  test: {
    // Playwright's e2e/*.spec.ts files have their own test() -- vitest must
    // not try to collect them too.
    exclude: [...configDefaults.exclude, 'e2e/**'],
  },
})

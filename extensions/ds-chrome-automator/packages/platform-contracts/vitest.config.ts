import { defineConfig } from 'vitest/config';

export default defineConfig({
  cacheDir: '../../node_modules/.vite/platform-contracts',
  test: {
    clearMocks: true,
    restoreMocks: true,
    include: ['tests/**/*.test.ts'],
  },
});

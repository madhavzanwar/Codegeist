import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      include: ['src/core/**/*.ts', 'src/jira/mapper.ts', 'src/jira/http.ts', 'src/seed/**/*.ts', 'src/lib/**/*.ts', 'src/twg/parse.ts'],
      reporter: ['text', 'text-summary'],
      thresholds: { lines: 85, functions: 85, branches: 75, statements: 85 },
    },
  },
});

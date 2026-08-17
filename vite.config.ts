/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // netlify dev builds the functions into .netlify/functions-serve and holds
    // those files locked; vite's watcher trips over them, crashes with EBUSY on
    // Windows and takes the whole dev server down. There is no reason at all for
    // vite to watch netlify's build output.
    watch: { ignored: ['**/.netlify/**'] },
  },
  test: {
    // node by default — the logic suite needs no DOM and starts faster without one.
    // The component tests opt themselves into jsdom with a
    // `// @vitest-environment jsdom` docblock, so only they pay for it.
    environment: 'node',
    // tests/db are integration tests against a local Supabase — skipped without DB_TESTS=1
    include: ['src/**/*.test.{ts,tsx}', 'tests/**/*.test.{ts,tsx}'],
    // The DB files share one database; parallelism between files = deadlocks on
    // the fixtures' DDL. Running them serially costs seconds and eliminates that
    // entire class of failure.
    fileParallelism: false,
  },
});

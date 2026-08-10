/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    // ברירת המחדל היא node; קובץ שצריך DOM מבקש זאת בעצמו בשורת
    // `// @vitest-environment jsdom` בראשו — כך בדיקה טהורה לא משלמת על jsdom.
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'netlify/functions/__tests__/**/*.test.ts'],
  },
});

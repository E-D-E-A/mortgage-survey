/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // netlify dev בונה פונקציות לתוך ‎.netlify/functions-serve‎ ומחזיק את
    // הקבצים נעולים; ה-watcher של vite שנתקל בהם קורס ב-EBUSY על Windows
    // ומפיל את כל שרת הפיתוח. אין שום סיבה ש-vite יצפה בתוצרים של netlify.
    watch: { ignored: ['**/.netlify/**'] },
  },
  test: {
    environment: 'node',
    // tests/db הן בדיקות אינטגרציה מול Supabase מקומי — מדולגות בלי DB_TESTS=1
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    // קבצי ה-DB חולקים דאטהבייס אחד; מקביליות בין קבצים = deadlocks על
    // ה-DDL של הפיקסטורות. ריצה טורית עולה שניות ומוחקת את כל המחלקה הזאת.
    fileParallelism: false,
  },
});

import { defineConfig } from 'vite';

/**
 * Builds ONE self-contained file, dist/widget.js, that works with a plain <script> tag
 * on any website (no modules, no framework, no other files to load).
 */
export default defineConfig({
  build: {
    target: 'es2019', // runs in every browser from the last several years
    sourcemap: true,
    emptyOutDir: true,
    lib: {
      entry: 'src/index.ts',
      formats: ['iife'],
      name: 'FeedbackHub', // the exports of index.ts become window.FeedbackHub
      fileName: () => 'widget.js',
    },
  },
});

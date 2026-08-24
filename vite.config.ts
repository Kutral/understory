import { defineConfig } from 'vite';

export default defineConfig({
  base: '/understory/',
  resolve: {
    alias: {
      '@': '/src',
      '@contracts': '/src/contracts',
    },
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    chunkSizeWarningLimit: 1200,
  },
  worker: {
    format: 'es',
  },
});

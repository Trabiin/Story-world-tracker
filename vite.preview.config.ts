/** Single-file browser preview build (everything inlined into one HTML file). */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [react(), viteSingleFile()],
  base: './',
  build: { target: 'es2021', outDir: 'dist-preview', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
});

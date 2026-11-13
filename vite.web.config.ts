/**
 * The app as an installable Chrome app (Chromebook): one HTML file plus a manifest, icons and a
 * service worker for offline use, published to GitHub Pages. Worlds are real .world files through
 * Chrome's file access (src/ui/platform/web.ts).
 */
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [
    react(),
    viteSingleFile(),
    {
      name: 'web-app-head',
      transformIndexHtml: (html) => html.replace('</head>', '    <link rel="manifest" href="manifest.webmanifest" />\n    <meta name="theme-color" content="#b5562c" />\n    <link rel="icon" href="icon-256.png" />\n  </head>'),
    },
  ],
  base: './',
  publicDir: 'web-public',
  define: { 'import.meta.env.VITE_WEB_APP': JSON.stringify('1') },
  build: { target: 'es2021', outDir: 'dist-web', assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
});

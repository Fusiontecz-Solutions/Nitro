import fs from 'fs';
import path from 'path';
import { defineConfig } from 'vite';
import * as vite from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/** react-pdf 9.2 pins pdfjs-dist@4.8.69. A newer hoisted copy breaks the worker. */
function pdfjsDistRoot(): string {
  const nested = path.resolve(
    __dirname,
    'node_modules/react-pdf/node_modules/pdfjs-dist',
  );
  if (fs.existsSync(path.join(nested, 'package.json'))) return nested;
  return path.resolve(__dirname, 'node_modules/pdfjs-dist');
}

function copyPdfjsWorker(): vite.Plugin {
  const copy = () => {
    const src = path.join(pdfjsDistRoot(), 'build/pdf.worker.min.mjs');
    const dest = path.resolve(__dirname, 'public/pdf.worker.min.mjs');
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  };
  return {
    name: 'copy-pdfjs-worker',
    buildStart() {
      copy();
    },
    configureServer() {
      copy();
    },
  };
}

const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "base-uri 'self'",
  "font-src 'self' data: https://fonts.gstatic.com",
  "form-action 'self'",
  "frame-ancestors 'self'",
  "img-src 'self' data: https: blob:",
  "object-src 'self' blob:",
  "script-src 'self' 'unsafe-inline' https://unpkg.com",
  "script-src-attr 'none'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "upgrade-insecure-requests",
  "worker-src 'self' blob: https://unpkg.com",
  "connect-src 'self' blob: wss: https://res.cloudinary.com https://*.cloudinary.com https://app.signnow.com https://api.signnow.com https://signnow.com https://unpkg.com",
  "frame-src 'self' blob: data: https://app.signnow.com https://www.signnow.com https://signnow.com https://*.signnow.com",
].join(';');

/** Confirms rolldown-vite (Rust bundler) is active — Vite's path to Turbopack-class performance. */
function rolldownBundlerBanner(): vite.Plugin {
  return {
    name: 'rolldown-bundler-banner',
    configureServer(server) {
      const version =
        'rolldownVersion' in vite && typeof vite.rolldownVersion === 'string'
          ? vite.rolldownVersion
          : 'unknown';
      server.config.logger.info(
        `[bundler] rolldown-vite ${version} (Rust) — use this stack instead of Next.js Turbopack on Vite apps`,
      );
    },
  };
}

function securityHeaders(): vite.Plugin {
  const apply = (
    _req: unknown,
    res: { setHeader: (name: string, value: string) => void },
    next: () => void,
  ) => {
    res.setHeader('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    next();
  };
  return {
    name: 'nitro-security-headers',
    configurePreviewServer(server) {
      server.middlewares.use(apply);
    },
  };
}

function signNowEmbeddedCompleteHtml(): vite.Plugin {
  const rewrite = (req: { url?: string }) => {
    const path = String(req.url || "").split("?")[0];
    if (path === "/embedded-complete" || path === "/embedded-complete/") {
      req.url = "/signnow-embedded-complete.html";
    }
  };
  return {
    name: "signnow-embedded-complete",
    configureServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, _res, next) => {
        rewrite(req);
        next();
      });
    },
  };
}

// https://vite.dev/guide/rolldown
export default defineConfig({
  plugins: [rolldownBundlerBanner(), copyPdfjsWorker(), securityHeaders(), signNowEmbeddedCompleteHtml(), react(), tailwindcss()],
  optimizeDeps: {
    include: ['stream-browserify', 'buffer', 'events', 'date-fns-tz', 'date-fns'],
    exclude: ['lucide-react'],
  },
  server: {
    port: 5175,
    strictPort: true,
  },
  build: {
    target: 'es2022',
    sourcemap: false,
    rollupOptions: {
      output: {
        manualChunks(rawId) {
          const id = rawId.replace(/\\/g, '/');
          if (!id.includes('/node_modules/')) return;
          const pkg = (name: string) => id.includes(`/node_modules/${name}/`);
          // Core runtime + state libs every page needs. redux/immer/reselect must
          // live here: recharts also depends on them, and when they were unmatched
          // the bundler parked them in vendor-charts, which made the entry (and the
          // login page) preload ~500 kB of chart code.
          if (
            pkg('react') || pkg('react-dom') || pkg('scheduler') || pkg('react-router') ||
            pkg('react-redux') || pkg('@reduxjs/toolkit') || pkg('redux') || pkg('redux-thunk') ||
            pkg('immer') || pkg('reselect') || pkg('use-sync-external-store')
          ) {
            return 'vendor-react';
          }
          if (pkg('@tanstack/react-query') || pkg('@tanstack/query-core')) return 'vendor-query';
          if (pkg('@mui/material') || pkg('@mui/system') || pkg('@mui/utils') || pkg('@mui/icons-material') || pkg('@mui/styled-engine') || pkg('@mui/private-theming') || pkg('@mui/core-downloads-tracker')) {
            return 'vendor-mui';
          }
          // recharts / pdfjs / react-pdf are deliberately NOT forced into named
          // chunks: the bundler pulls a manual chunk's dependencies (lodash, clsx,
          // ...) in with it, and the app entry then had to preload the whole chart
          // and PDF bundles on every page. Default splitting keeps them with the
          // lazy routes that actually use them.
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      // pdfjs / react-pdf touch Node's `stream`; Vite externalizes it unless polyfilled.
      stream: 'stream-browserify',
      buffer: 'buffer',
      events: path.resolve(__dirname, 'node_modules/events/events.js'),
      'date-fns-tz': path.resolve(
        __dirname,
        'node_modules/date-fns-tz/dist/esm/index.js',
      ),
    },
  },
});

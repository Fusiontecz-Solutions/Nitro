import path from 'path';
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  optimizeDeps: {
    include: ["stream-browserify", "buffer", "events"],
    exclude: ["lucide-react"],
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // pdfjs / react-pdf (pulled in via static route imports) touch Node's `stream`; Vite externalizes it unless polyfilled.
      stream: "stream-browserify",
      buffer: "buffer",
      events: path.resolve(__dirname, "node_modules/events/events.js"),
    },
  },
})

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

function injectEnvIntoPublicHtml(): import('vite').Plugin {
  return {
    name: 'inject-env-public-html',
    closeBundle() {
      const target = resolve(__dirname, 'dist/client-monitor.html');
      try {
        let html = readFileSync(target, 'utf-8');
        html = html.replace(/__SUPABASE_URL__/g, process.env.VITE_SUPABASE_URL ?? '');
        writeFileSync(target, html, 'utf-8');
      } catch {}
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react(), injectEnvIntoPublicHtml()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
});

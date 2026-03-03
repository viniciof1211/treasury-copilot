import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['lucide-react'],
  },
  server: {
    proxy: {
      '/agent': 'http://localhost:8001',
      '/health': 'http://localhost:8001',
      '/pcgraf': 'http://localhost:8001',
      '/erp': 'http://localhost:8001',
      '/contracts': 'http://localhost:8001',
      '/tms': 'http://localhost:8001',
      '/kb': 'http://localhost:8001',
      '/sessions': 'http://localhost:8001',
      '/entity': 'http://localhost:8001',
      '/dashboard': 'http://localhost:8001',
      '/tica': 'http://localhost:8001',
    },
  },
});

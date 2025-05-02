import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src', // Set the root directory to 'src'
  build: {
    outDir: '../dist/src', // Ensure build output goes to the correct place relative to the project root
  },
  server: { // Add server configuration
    proxy: {
      // Proxy /api requests to the backend server
      '/api': {
        target: 'http://localhost:3000', // Your backend server address
        changeOrigin: true, // Recommended for virtual hosted sites
        // No rewrite needed, as backend routes include /api
      },
    },
  },
});

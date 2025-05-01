import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  root: 'src', // Set the root directory to 'src'
  build: {
    outDir: '../dist/src', // Ensure build output goes to the correct place relative to the project root
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    // Web Serial needs a secure context; localhost counts as one.
    host: 'localhost',
    port: 5173,
  },
});

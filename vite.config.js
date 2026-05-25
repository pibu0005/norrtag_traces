import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    // Allow accessing dev server through ngrok hostnames.
    // Add/remove hosts here as needed.
    allowedHosts: ['expanse-dividing-satisfy.ngrok-free.dev'],
  },
})

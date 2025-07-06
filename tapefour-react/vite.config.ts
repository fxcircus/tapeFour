import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  base: '/tapeFour/',
  plugins: [react()],
  server: {
    host: 'localhost',
    port: 3000
  }
})

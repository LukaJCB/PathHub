import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    tailwindcss(),
    react({
      jsxRuntime: 'automatic',
    }),
  ],
  server: {
    proxy: {
        '/auth': {
            target: 'http://localhost:3000',
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/auth/, ''),
        },
        '/storage': {
            target: 'http://localhost:3001',
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/storage/, ''),
        },
        '/messaging': {
            target: 'http://localhost:3002',
            changeOrigin: true,
            secure: false,
            rewrite: (path) => path.replace(/^\/messaging/, ''),
        },
    },}
})

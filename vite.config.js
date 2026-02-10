import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  base: '/licitaciones/',
  server: {
    proxy: {
      '/api-estado': {
        target: 'https://contrataciondelestado.es',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api-estado/, ''),
      }
    }
  }
})
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@shared': path.resolve(__dirname, '../shared')
    }
  },
  server: {
    proxy: { '/api': 'http://127.0.0.1:4000' },
    fs: { allow: [path.resolve(__dirname, '..')] }
  },
  build: { outDir: 'dist' }
})

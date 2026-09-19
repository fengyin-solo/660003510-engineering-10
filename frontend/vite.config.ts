import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { examplesPlugin } from './vite-plugin-examples.mjs'

export default defineConfig({
  plugins: [vue(), examplesPlugin()],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  server: {
    open: false,
    port: 5173
  }
})

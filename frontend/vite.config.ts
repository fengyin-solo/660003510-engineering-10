import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { resolve } from 'path'
import { fileURLToPath } from 'url'
import { exampleDataPlugin } from './scripts/vite-plugin-data-guard.mjs'

const here = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig({
  plugins: [
    vue(),
    // 启动开发服务器与构建时校验 public/data 下的示例数据
    exampleDataPlugin(resolve(here, 'public/data'))
  ],
  resolve: {
    alias: { '@': resolve(__dirname, 'src') }
  },
  server: {
    open: false,
    port: 5173
  }
})

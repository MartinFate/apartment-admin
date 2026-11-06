import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import { fileURLToPath, URL } from 'node:url'

// 开发时后端地址（Node/Express）默认 3000，生产由 nginx 反代 /api
// 移动端视图里显式按需引入 Vant 组件 + 各自 CSS；
// 移动视图是懒加载的，所以桌面端不会加载 Vant。
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url))
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      }
    }
  }
})

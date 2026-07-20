import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'path'

// 同一次构建输出两个入口：index.html 是管理面板，pet.html 是 Electron 透明窗口页面。
// 两者共享依赖 chunk，但拥有独立 React 根节点和样式入口。
export default defineConfig(({ command }) => ({
  plugins: [react()],
  // Development serves the user's local public/ resources directly. Production
  // packaging copies an explicit allowlist via Electron Builder, so Vite must not
  // silently bundle ignored models, presets, or personal images into dist/.
  publicDir: command === 'serve' ? 'public' : false,
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        pet: resolve(__dirname, 'pet.html'),
      },
    },
  },
}))

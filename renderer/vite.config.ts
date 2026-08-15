import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

// 双入口：仪表盘 + 悬浮小窗（与 Electron main.js 的 loadFile 一一对应）
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: {
        dashboard: path.resolve(__dirname, 'dashboard.html'),
        widget: path.resolve(__dirname, 'widget.html'),
      },
    },
  },
  server: {
    port: 5173,
    strictPort: true,
  },
});

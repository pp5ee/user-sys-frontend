import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 构建产物是纯静态文件，直接放到后端静态目录（/var/www/team-tasks）即可同源调 /api。
// base 用相对路径，放在任意子目录下都能加载 assets。
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.js',
    css: false,
  },
});

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 线上接口和页面同源；这几条只用于本地 mock / 预览。
const CONNECT_EXTRA = ["'self'", 'http://47.108.60.176', 'http://localhost:*', 'http://127.0.0.1:*'].join(' ');

const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // React 的 style 属性和现有样式表都需要 inline 样式
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "font-src 'self'",
  `connect-src ${CONNECT_EXTRA}`,
  "object-src 'none'",
  "media-src 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
].join('; ');

/**
 * 只在构建产物里注入 CSP。开发模式下 Vite 会注入内联的 HMR / React Refresh 脚本，
 * 直接写在 index.html 里会把 `npm run dev` 弄坏。
 * 注意：frame-ancestors 在 meta 里不生效，防点击劫持要靠服务器返回 X-Frame-Options。
 */
function securityMeta() {
  return {
    name: 'cyops-security-meta',
    apply: 'build',
    transformIndexHtml() {
      return [
        {
          tag: 'meta',
          attrs: { 'http-equiv': 'Content-Security-Policy', content: CSP },
          injectTo: 'head-prepend',
        },
      ];
    },
  };
}

// 构建产物是纯静态文件，直接放到后端静态目录（/var/www/team-tasks）即可同源调 /api。
// base 用相对路径，放在任意子目录下都能加载 assets。
export default defineConfig({
  base: './',
  plugins: [react(), securityMeta()],
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

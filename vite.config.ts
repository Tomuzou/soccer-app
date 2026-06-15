import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 本番ビルド時のみ GitHub Pages 用のサブパスを base にする。
// 開発サーバー(dev)では '/' のままにして localhost で素直に開けるようにする。
export default defineConfig(({ command }) => ({
  base: command === 'build' ? '/soccer-app/' : '/',
  plugins: [react()],
}));

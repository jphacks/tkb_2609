import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// スマホ実機（モバイル回線）での確認用に、Cloudflare の一時トンネル経由のアクセスを許可する
const allowedHosts = ['.trycloudflare.com']

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: { allowedHosts },
  preview: { allowedHosts },
})

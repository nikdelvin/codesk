import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import { cloudflare } from '@cloudflare/vite-plugin'
import tailwindcss from '@tailwindcss/vite'
import { PUBLIC_ORIGIN } from './src/plugin/config.ts'

export default defineConfig(({ command }) => ({
  // MCP hosts receive HTML as text, so production asset URLs must be absolute.
  base: command === 'build' ? `${PUBLIC_ORIGIN}/` : '/',
  plugins: [tailwindcss(), react(), cloudflare({ viteEnvironment: { name: 'worker' } })],
  server: { headers: { 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' } },
}))

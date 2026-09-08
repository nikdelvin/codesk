import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
import { uiAssets } from './scripts/ui-assets.mjs'
export default defineConfig({ plugins: [uiAssets(import.meta.dirname), tailwindcss(), react(), viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true } })

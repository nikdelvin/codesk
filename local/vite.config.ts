import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig } from 'vite'
import { viteSingleFile } from 'vite-plugin-singlefile'
export default defineConfig({ plugins: [tailwindcss(), react(), viteSingleFile()],
  build: { outDir: 'dist', emptyOutDir: true } })

import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vite.dev/config/
export default defineConfig({
  // relativní cesty: aplikace běží na GitHub Pages pod /revize-aplikace/ i jinde
  base: './',
  plugins: [react()],
})

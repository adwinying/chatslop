import babel from '@rolldown/plugin-babel'
import tailwindcss from '@tailwindcss/vite'
import { tanstackStart } from '@tanstack/react-start/plugin/vite'
import react, { reactCompilerPreset } from '@vitejs/plugin-react'
import { nitro } from 'nitro/vite'
import { defineConfig } from 'vite'

export default defineConfig({
  // On every interface, for testing from other devices on the LAN.
  server: { host: true, port: 3000, strictPort: true },
  resolve: { tsconfigPaths: true },
  ssr: { noExternal: ['@convex-dev/better-auth'] },
  plugins: [
    tailwindcss(),
    tanstackStart(),
    react(),
    babel({ presets: [reactCompilerPreset()] }),
    nitro({ serverDir: './server', features: { websocket: true } }),
  ],
})

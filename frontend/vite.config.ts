import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

/** Set in docker-compose for the Vite container: same-origin /api goes to Traefik+Authelia, not to uvicorn directly. */
const viteDocker = process.env.VITE_DOCKER_DEV === '1'

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    // Traefik forwards Host: app.miootz.local; Vite 6+ blocks unknown hosts by default.
    allowedHosts: viteDocker ? true : ['localhost', '127.0.0.1', 'app.miootz.local'],
    watch: viteDocker ? { usePolling: true } : undefined,
    hmr: viteDocker ? { clientPort: 8443 } : undefined,
    ...(viteDocker
      ? {}
      : {
          proxy: {
            '/api': {
              target: 'http://127.0.0.1:8000',
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ''),
            },
            '/uploads': {
              target: 'http://127.0.0.1:8000',
              changeOrigin: true,
            },
          },
        }),
  },
})

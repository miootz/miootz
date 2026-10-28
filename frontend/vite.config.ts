import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Docker routes /api through Traefik; standalone Vite proxies to the local API. */
const viteDocker = process.env.VITE_DOCKER_DEV === "1";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Traefik forwards Host: app.miootz.local; Vite 6+ blocks unknown hosts by default.
    allowedHosts: viteDocker
      ? true
      : ["localhost", "127.0.0.1", "app.miootz.local"],
    watch: viteDocker ? { usePolling: true } : undefined,
    hmr: viteDocker ? { clientPort: 8443 } : undefined,
    ...(viteDocker
      ? {}
      : {
          proxy: {
            "/api": {
              target:
                process.env.MIOOTZ_API_PROXY_TARGET || "http://127.0.0.1:8000",
              changeOrigin: true,
              rewrite: (path) => path.replace(/^\/api/, ""),
            },
          },
        }),
  },
});

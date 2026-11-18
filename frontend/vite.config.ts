import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

/** Docker routes /api through Traefik; standalone Vite proxies to the local API. */
const viteDocker = process.env.VITE_DOCKER_DEV === "1";
// Dev HTTPS for secure-context testing on phones (the demo's --https flag
// provisions an mkcert pair and points these at it).
const sslKeyFile = process.env.VITE_SSL_KEYFILE;
const sslCertFile = process.env.VITE_SSL_CERTFILE;
// Extra Hosts accepted by Vite 6+ (comma-separated) — the demo binds to
// LAN/WireGuard IPs for on-site testing.
const extraAllowedHosts = (process.env.VITE_ALLOWED_HOSTS ?? "")
  .split(",")
  .map((h) => h.trim())
  .filter(Boolean);
const { version: appVersion } = JSON.parse(
  readFileSync(new URL("./package.json", import.meta.url), "utf8"),
) as { version: string };

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    {
      name: "app-version",
      transformIndexHtml: () => [
        { tag: "meta", attrs: { name: "app-version", content: appVersion }, injectTo: "head" },
      ],
      generateBundle() {
        this.emitFile({
          type: "asset",
          fileName: "sw.js",
          source: `/* Miootz v${appVersion} */\n${readFileSync(new URL("./public/sw.js", import.meta.url), "utf8")}`,
        });
      },
    },
  ],
  server: {
    host: "0.0.0.0",
    port: 5173,
    strictPort: true,
    // Traefik forwards Host: app.miootz.local; Vite 6+ blocks unknown hosts by default.
    allowedHosts: viteDocker
      ? true
      : ["localhost", "127.0.0.1", "app.miootz.local", ...extraAllowedHosts],
    watch: viteDocker ? { usePolling: true } : undefined,
    hmr: viteDocker ? { clientPort: 8443 } : undefined,
    https:
      sslKeyFile && sslCertFile
        ? { key: readFileSync(sslKeyFile), cert: readFileSync(sslCertFile) }
        : undefined,
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

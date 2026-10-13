import { defineConfig, loadEnv } from "vite";
import vue from "@vitejs/plugin-vue";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const host = env.VITE_HOST || "0.0.0.0";
  const port = Number(env.VITE_PORT || 5173);
  const previewPort = Number(env.VITE_PREVIEW_PORT || 4173);
  const apiTarget =
    env.VITE_API_TARGET || `http://127.0.0.1:${env.VITE_SERVER_PORT || 3000}`;

  return {
    plugins: [vue()],
    server: {
      host,
      port,
      strictPort: true,
      proxy: {
        "/api": {
          target: apiTarget,
          changeOrigin: true,
        },
      },
    },
    preview: {
      host,
      port: previewPort,
      strictPort: true,
    },
  };
});

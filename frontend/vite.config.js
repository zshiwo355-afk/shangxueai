import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: path.resolve(__dirname),
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8000",
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, "index.html"),
      },
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          if (id.includes("@ant-design/icons")) return "vendor-icons";
          if (id.includes("/antd/") || id.includes("\\antd\\")) return "vendor-antd";
          if (
            id.includes("rc-") ||
            id.includes("@rc-component") ||
            id.includes("@ant-design/cssinjs") ||
            id.includes("@ant-design/colors")
          ) {
            return "vendor-antd";
          }
          if (id.includes("react-router")) return "vendor-router";
          if (
            id.includes("/echarts/") ||
            id.includes("\\echarts\\") ||
            id.includes("/zrender/") ||
            id.includes("\\zrender\\")
          ) {
            // echarts 仅管理后台数据看板使用，单独分包以便随懒加载的 Dashboard
            // 按需加载，避免混入首屏通用 vendor（约 600KB）。
            return "vendor-echarts";
          }
          if (
            id.includes("/react/") ||
            id.includes("\\react\\") ||
            id.includes("/react-dom/") ||
            id.includes("\\react-dom\\") ||
            id.includes("scheduler")
          ) {
            return "vendor-react";
          }
          if (id.includes("dayjs")) return "vendor-dayjs";
          if (
            id.includes("react-markdown") ||
            id.includes("remark-") ||
            id.includes("micromark") ||
            id.includes("mdast-") ||
            id.includes("hast-") ||
            id.includes("unist-") ||
            id.includes("unified") ||
            id.includes("vfile") ||
            id.includes("decode-named-character-reference") ||
            id.includes("character-entities") ||
            id.includes("trim-lines") ||
            id.includes("zwitch") ||
            id.includes("trough")
          ) {
            return "vendor-markdown";
          }
          return "vendor";
        },
      },
    },
  },
});

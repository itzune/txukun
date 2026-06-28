import { defineConfig } from "vite";

const base = "/txukun/";

export default defineConfig({
  base,
  server: {
    port: 3000,
  },
  build: {
    target: "esnext",
    outDir: "dist",
  },
});

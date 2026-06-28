import { defineConfig } from "vite";

const base = "/txukun/";

export default defineConfig({
  base,
  server: {
    port: 3000,
    // Ensure .onnx files are served with correct MIME type
    fs: {
      allow: ["."],
    },
  },
  build: {
    target: "esnext",
    outDir: "dist",
    rollupOptions: {
      input: {
        main: "index.html",
      },
    },
  },
  // Ensure .onnx files get correct content-type
  plugins: [
    {
      name: "onnx-mime",
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url?.endsWith(".onnx")) {
            res.setHeader("Content-Type", "application/octet-stream");
          }
          next();
        });
      },
    },
  ],
});

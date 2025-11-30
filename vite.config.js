import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Build configuration for production
  build: {
    outDir: "dist",
    assetsDir: "assets",
    sourcemap: false, // Disable sourcemaps in production for smaller bundle
    minify: "esbuild", // Fast minification
    rollupOptions: {
      output: {
        manualChunks: {
          // Split vendor chunks for better caching
          vendor: ["react", "react-dom"],
          firebase: ["firebase/app", "firebase/auth", "firebase/firestore"],
        },
      },
    },
  },
  // Note: Vite only exposes environment variables prefixed with VITE_ to client code
  // So CURSOR_API_KEY must be VITE_CURSOR_API_KEY in .env file
});


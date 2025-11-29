import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Note: Vite only exposes environment variables prefixed with VITE_ to client code
  // So CURSOR_API_KEY must be VITE_CURSOR_API_KEY in .env file
});

